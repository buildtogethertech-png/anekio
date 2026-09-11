import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { s3Client, usesS3Uploads } from "./s3-client";

export const UPLOAD_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function uploadsRoot() {
  return process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");
}

export function uploadSchoolKey() {
  const value =
    process.env.ANEKIO_SCHOOL_KEY ||
    process.env.VERCEL_PROJECT_ID ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    "school";
  return safePathSegment(value, "school");
}

export function safePathSegment(value: unknown, fallback = "item") {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || fallback;
}

export function safeFileName(name: string) {
  const extension = path.extname(String(name || "")).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
  return `${randomUUID()}${extension}`;
}

export function createUploadPath(folder: string, originalName: string) {
  const cleanFolder = folder.replace(/^\/+|\/+$/g, "");
  if (!cleanFolder || cleanFolder.includes("..")) throw new Error("Invalid upload folder");
  return `${cleanFolder}/${safeFileName(originalName)}`;
}

export function resolveUploadPath(rel: string) {
  const clean = rel.replace(/^\/+/, "");
  if (!clean || clean.includes("..")) throw new Error("Invalid path");
  const publicFile = clean.startsWith("public/") || (clean.startsWith("school/") && !clean.startsWith("school/admissions/"));
  return {
    rel: clean,
    abs: path.join(uploadsRoot(), clean),
    publicFile,
    publicSchool: publicFile,
  };
}

function s3Target(rel: string) {
  const resolved = resolveUploadPath(rel);
  const visibility = resolved.publicFile ? "public" : "private";
  const configuredBucket = visibility === "public"
    ? process.env.AWS_S3_PUBLIC_BUCKET || process.env.AWS_S3_BUCKET
    : process.env.AWS_S3_PRIVATE_BUCKET || process.env.AWS_S3_BUCKET;
  const bucket = String(configuredBucket || "").trim();
  if (!bucket) throw new Error(`AWS_S3_${visibility.toUpperCase()}_BUCKET is required for S3 uploads`);
  const explicitPrefix = `${visibility}/`;
  const key = resolved.rel.startsWith(explicitPrefix)
    ? resolved.rel.slice(explicitPrefix.length)
    : `legacy/${resolved.rel}`;
  return { bucket, key, ...resolved };
}

export function uploadContentType(name: string, mime = "") {
  return UPLOAD_TYPES[path.extname(name).toLowerCase()] || mime || "application/octet-stream";
}

export async function saveUploadPath(rel: string, buf: Buffer, mime = "") {
  if (usesS3Uploads()) {
    const target = s3Target(rel);
    await s3Client().send(new PutObjectCommand({
      Bucket: target.bucket,
      Key: target.key,
      Body: buf,
      ContentType: uploadContentType(rel, mime),
    }));
    return target.rel;
  }
  const resolved = resolveUploadPath(rel);
  await mkdir(path.dirname(resolved.abs), { recursive: true });
  await writeFile(resolved.abs, buf);
  return resolved.rel;
}

export async function saveUpload(folder: string, originalName: string, buf: Buffer, mime = "") {
  return saveUploadPath(createUploadPath(folder, originalName), buf, mime);
}

export async function deleteUpload(rel: string) {
  if (usesS3Uploads()) {
    const target = s3Target(rel);
    await s3Client().send(new DeleteObjectCommand({ Bucket: target.bucket, Key: target.key }));
    return;
  }
  const { abs } = resolveUploadPath(rel);
  await unlink(abs).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function readUpload(rel: string) {
  if (usesS3Uploads()) {
    const target = s3Target(rel);
    const object = await s3Client().send(new GetObjectCommand({ Bucket: target.bucket, Key: target.key }));
    if (!object.Body) throw new Error("Upload body missing");
    const buf = Buffer.from(await object.Body.transformToByteArray());
    return { buf, type: object.ContentType || uploadContentType(target.rel) };
  }
  const { abs, rel: clean } = resolveUploadPath(rel);
  const buf = await readFile(abs);
  return { buf, type: uploadContentType(clean) };
}

export async function readUploadDataUrl(rel?: string | null) {
  if (!rel) return "";
  const { buf, type } = await readUpload(rel);
  return `data:${type};base64,${buf.toString("base64")}`;
}

export async function uploadMetadata(rel: string) {
  if (!usesS3Uploads()) {
    const { buf, type } = await readUpload(rel);
    return { size: buf.length, type };
  }
  const target = s3Target(rel);
  const object = await s3Client().send(new HeadObjectCommand({ Bucket: target.bucket, Key: target.key }));
  return { size: Number(object.ContentLength || 0), type: object.ContentType || uploadContentType(target.rel) };
}

export async function presignedUploadUrl(rel: string, mime: string) {
  if (!usesS3Uploads()) return "";
  const target = s3Target(rel);
  return getSignedUrl(
    s3Client(),
    new PutObjectCommand({ Bucket: target.bucket, Key: target.key, ContentType: uploadContentType(rel, mime) }),
    { expiresIn: 15 * 60 }
  );
}

export async function presignedReadUrl(rel: string) {
  if (!usesS3Uploads()) return "";
  const target = s3Target(rel);
  return getSignedUrl(
    s3Client(),
    new GetObjectCommand({ Bucket: target.bucket, Key: target.key }),
    { expiresIn: target.publicFile ? 60 * 60 : 5 * 60 }
  );
}

export function isQuestionPaperFile(name: string, mime = "") {
  const extension = path.extname(String(name || "")).toLowerCase();
  const extensions = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".webp"];
  if (extension && !extensions.includes(extension)) return false;
  const mimes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
    "image/webp",
  ];
  return mimes.includes(mime) || ((!mime || mime === "application/octet-stream") && extensions.includes(extension));
}
