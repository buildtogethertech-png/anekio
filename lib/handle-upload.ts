import { createHmac, timingSafeEqual } from "node:crypto";
import { can, type AccessUser } from "./permissions";
import { prisma } from "./prisma";
import {
  createUploadPath,
  deleteUpload,
  isQuestionPaperFile,
  presignedUploadUrl,
  safePathSegment,
  saveUploadPath,
  uploadMetadata,
  uploadContentType,
  uploadSchoolKey,
} from "./uploads";
import { usesS3Uploads } from "./s3-client";
import { uploadPaperCore, uploadQuestionPaperCore } from "./core-office";
import { collectFeeCore } from "./core-actions";

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const UPLOAD_INTENT_SECONDS = 15 * 60;

type UploadFile = { name: string; mime: string; size: number };

type UploadIntent = {
  exp: number;
  fields: Record<string, string>;
  fileName: string;
  kind: string;
  mime: string;
  path: string;
  size: number;
  userId: string;
};

function uploadSecret() {
  const secret = process.env.APP_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("APP_JWT_SECRET or JWT_SECRET is required");
  return secret;
}

function extensionAllowed(name: string, extensions: string[]) {
  const lower = name.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

function allowedFile(name: string, mime: string, extensions: string[], mimes: string[]) {
  const extension = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || "";
  if (extension && !extensions.includes(extension)) return false;
  return mimes.includes(mime) || ((!mime || mime === "application/octet-stream") && extensionAllowed(name, extensions));
}

function isImage(name: string, mime: string) {
  return allowedFile(name, mime, [".jpg", ".jpeg", ".png", ".webp"], ["image/jpeg", "image/png", "image/webp"]);
}

function isReceiptFile(name: string, mime: string) {
  return allowedFile(
    name,
    mime,
    [".jpg", ".jpeg", ".png", ".webp", ".pdf"],
    ["image/jpeg", "image/png", "image/webp", "application/pdf"]
  );
}

function isOnboardingSheet(name: string, mime: string) {
  return allowedFile(
    name,
    mime,
    [".csv", ".xlsx"],
    ["text/csv", "application/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
  );
}

function stringFields(fields: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => typeof value === "string" || typeof value === "number")
      .map(([key, value]) => [key, String(value).slice(0, 500)])
  );
}

function schoolRoot() {
  return `schools/${uploadSchoolKey()}`;
}

function validateAndFolder(user: AccessUser, file: UploadFile, fields: Record<string, string>) {
  if (!file.name || file.size <= 0) throw new Error("File required");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File must be 12 MB or smaller");
  const kind = String(fields.kind || "paper");

  if (kind === "question") {
    if (!can(user, "papers.upload") && !can(user, "exams.edit")) throw new Error("No access.");
    if (!fields.examId) throw new Error("Exam required");
    if (!isQuestionPaperFile(file.name, file.mime)) throw new Error("Upload the question paper as a PDF, Word file, or image.");
    return { kind, folder: `private/${schoolRoot()}/exams/${safePathSegment(fields.examId)}/question-papers` };
  }

  if (kind === "paper") {
    if (!can(user, "papers.upload")) throw new Error("No access.");
    if (!fields.examId || !fields.studentId) throw new Error("Exam and student are required");
    if (!isQuestionPaperFile(file.name, file.mime)) throw new Error("Upload the paper as a PDF, Word file, or image.");
    const paperType = ["MARK_SHEET", "ANSWER_SHEET", "EVALUATED"].includes(fields.type) ? fields.type : "EVALUATED";
    return {
      kind,
      folder: `private/${schoolRoot()}/exams/${safePathSegment(fields.examId)}/students/${safePathSegment(fields.studentId)}/${paperType.toLowerCase().replaceAll("_", "-")}`,
    };
  }

  if (kind === "receipt") {
    if (!can(user, "fees.collect")) throw new Error("No access.");
    if (!fields.invoiceId) throw new Error("Invoice required");
    if (!isReceiptFile(file.name, file.mime)) throw new Error("Upload the payment proof as a PDF or image.");
    return {
      kind,
      folder: `private/${schoolRoot()}/fees/${safePathSegment(fields.invoiceId)}/payment-proofs`,
    };
  }

  if (kind === "school") {
    if (!can(user, "school.edit")) throw new Error("No access.");
    if (!isImage(file.name, file.mime)) throw new Error("Upload a PNG, JPEG, or WebP image.");
    const folders: Record<string, string> = {
      logoPath: `public/${schoolRoot()}/branding/logos`,
      signPath: `private/${schoolRoot()}/branding/signatures`,
      stampPath: `private/${schoolRoot()}/branding/stamps`,
    };
    const folder = folders[fields.asset];
    if (!folder) throw new Error("School asset type required");
    return { kind, folder };
  }

  if (kind === "onboarding") {
    if (!can(user, "onboarding.manage") && !can(user, "people.import")) throw new Error("No access.");
    if (!isOnboardingSheet(file.name, file.mime)) throw new Error("Upload an Anekio Excel or CSV template.");
    return { kind, folder: `private/${schoolRoot()}/onboarding/imports` };
  }

  throw new Error("Unknown upload");
}

export function prepareFileUpload(user: AccessUser, file: UploadFile, rawFields: Record<string, unknown>) {
  const fields = stringFields(rawFields);
  const { kind, folder } = validateAndFolder(user, file, fields);
  return {
    exp: Math.floor(Date.now() / 1000) + UPLOAD_INTENT_SECONDS,
    fields,
    fileName: file.name,
    kind,
    mime: uploadContentType(file.name, file.mime),
    path: createUploadPath(folder, file.name),
    size: file.size,
    userId: user.id,
  } satisfies UploadIntent;
}

function signIntent(intent: UploadIntent) {
  const body = Buffer.from(JSON.stringify(intent)).toString("base64url");
  const signature = createHmac("sha256", uploadSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyUploadIntent(user: AccessUser, token: string) {
  const [body, signature, extra] = String(token || "").split(".");
  if (!body || !signature || extra) throw new Error("Upload confirmation is invalid");
  const expected = createHmac("sha256", uploadSecret()).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Upload confirmation is invalid");
  const intent = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UploadIntent;
  if (intent.userId !== user.id || intent.exp < Math.floor(Date.now() / 1000)) throw new Error("Upload confirmation expired");
  validateAndFolder(user, { name: intent.fileName, mime: intent.mime, size: intent.size }, intent.fields);
  const visibility = intent.path.startsWith("public/") ? "public" : "private";
  if (!intent.path.startsWith(`${visibility}/${schoolRoot()}/`)) throw new Error("Upload confirmation is invalid");
  return intent;
}

async function finalizeFileUpload(user: AccessUser, intent: UploadIntent) {
  const fields = intent.fields;
  if (intent.kind === "question") {
    const current = await prisma.exam.findUnique({ where: { id: fields.examId }, select: { paperFilePath: true } });
    if (current?.paperFilePath !== intent.path) {
      await uploadQuestionPaperCore(user, {
        examId: fields.examId,
        fileName: intent.fileName,
        filePath: intent.path,
        mime: intent.mime,
      });
    }
  } else if (intent.kind === "paper") {
    const current = await prisma.examPaper.findFirst({ where: { filePath: intent.path }, select: { id: true } });
    if (!current) {
      await uploadPaperCore(user, {
        examId: fields.examId,
        studentId: fields.studentId,
        type: fields.type,
        notes: fields.notes,
        fileName: intent.fileName,
        filePath: intent.path,
      });
    }
  } else if (intent.kind === "receipt") {
    const current = await prisma.payment.findFirst({ where: { proofPath: intent.path }, select: { id: true } });
    if (!current) {
      await collectFeeCore(user, {
        invoiceId: fields.invoiceId,
        amount: Number(fields.amount || 0) || undefined,
        method: fields.method,
        reference: fields.reference,
        notes: fields.notes,
        proofPath: intent.path,
      });
    }
  }
  return { path: intent.path, fileName: intent.fileName };
}

export async function preparePresignedFileUpload(user: AccessUser, file: UploadFile, fields: Record<string, unknown>) {
  const intent = prepareFileUpload(user, file, fields);
  if (!usesS3Uploads()) return { direct: false as const };
  return {
    direct: true as const,
    uploadUrl: await presignedUploadUrl(intent.path, intent.mime),
    completionToken: signIntent(intent),
    headers: { "Content-Type": intent.mime },
  };
}

export async function completePresignedFileUpload(user: AccessUser, token: string) {
  if (!usesS3Uploads()) throw new Error("Direct upload is not configured");
  const intent = verifyUploadIntent(user, token);
  const metadata = await uploadMetadata(intent.path);
  if (metadata.size !== intent.size || metadata.size <= 0 || metadata.size > MAX_UPLOAD_BYTES) {
    await deleteUpload(intent.path);
    throw new Error("Uploaded file size does not match");
  }
  try {
    return await finalizeFileUpload(user, intent);
  } catch (error) {
    await deleteUpload(intent.path).catch(() => undefined);
    throw error;
  }
}

export async function handleFileUpload(
  user: AccessUser,
  file: { buf: Buffer; name: string; mime: string },
  fields: Record<string, string>
) {
  const intent = prepareFileUpload(user, { name: file.name, mime: file.mime, size: file.buf.length }, fields);
  await saveUploadPath(intent.path, file.buf, intent.mime);
  try {
    return await finalizeFileUpload(user, intent);
  } catch (error) {
    await deleteUpload(intent.path).catch(() => undefined);
    throw error;
  }
}
