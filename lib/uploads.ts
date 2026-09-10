import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

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

export function safeFileName(name: string) {
  return `${Date.now()}-${String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

export async function saveUpload(folder: string, originalName: string, buf: Buffer) {
  const dir = path.join(uploadsRoot(), folder);
  await mkdir(dir, { recursive: true });
  const safe = safeFileName(originalName);
  await writeFile(path.join(dir, safe), buf);
  return `${folder}/${safe}`;
}

export function resolveUploadPath(rel: string) {
  const clean = rel.replace(/^\/+/, "");
  if (!clean || clean.includes("..")) throw new Error("Invalid path");
  return { rel: clean, abs: path.join(uploadsRoot(), clean), publicSchool: clean.startsWith("school/") };
}

export async function readUpload(rel: string) {
  const { abs, rel: clean } = resolveUploadPath(rel);
  const buf = await readFile(abs);
  const type = UPLOAD_TYPES[path.extname(clean).toLowerCase()] || "application/octet-stream";
  return { buf, type };
}

export function isQuestionPaperFile(name: string, mime = "") {
  if (/\.(pdf|docx?|jpe?g|png|webp)$/i.test(name || "")) return true;
  return [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
    "image/webp",
  ].includes(mime);
}
