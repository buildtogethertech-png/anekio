import type { AccessUser } from "./permissions";
import { can } from "./permissions";
import { isQuestionPaperFile, saveUpload } from "./uploads";
import { uploadPaperCore, uploadQuestionPaperCore } from "./core-office";
import { collectFeeCore } from "./core-actions";

export async function handleFileUpload(
  user: AccessUser,
  file: { buf: Buffer; name: string; mime: string },
  fields: Record<string, string>
) {
  const kind = String(fields.kind || "paper");
  if (kind === "question") {
    if (!can(user, "papers.upload") && !can(user, "exams.edit")) throw new Error("No access.");
    if (!isQuestionPaperFile(file.name, file.mime)) {
      throw new Error("Upload the question paper as a PDF or Word file.");
    }
    const filePath = await saveUpload("papers", file.name, file.buf);
    await uploadQuestionPaperCore(user, {
      examId: fields.examId,
      fileName: file.name,
      filePath,
      mime: file.mime,
    });
    return { path: filePath, fileName: file.name };
  }
  if (kind === "paper") {
    const filePath = await saveUpload("papers", file.name, file.buf);
    await uploadPaperCore(user, {
      examId: fields.examId,
      studentId: fields.studentId,
      type: fields.type,
      notes: fields.notes,
      fileName: file.name,
      filePath,
    });
    return { path: filePath, fileName: file.name };
  }
  if (kind === "receipt") {
    if (!can(user, "fees.collect")) throw new Error("No access.");
    const filePath = await saveUpload("receipts", file.name, file.buf);
    if (fields.invoiceId) {
      await collectFeeCore(user, {
        invoiceId: fields.invoiceId,
        amount: Number(fields.amount || 0) || undefined,
        method: fields.method,
        reference: fields.reference,
        notes: fields.notes,
        proofPath: filePath,
      });
    }
    return { path: filePath, fileName: file.name };
  }
  if (kind === "school") {
    if (!can(user, "school.edit")) throw new Error("No access.");
    const folder = "school";
    const filePath = await saveUpload(folder, file.name, file.buf);
    return { path: filePath, fileName: file.name };
  }
  throw new Error("Unknown upload");
}
