import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareFileUpload, preparePresignedFileUpload, verifyUploadIntent } from "../../lib/handle-upload";
import type { AccessUser } from "../../lib/permissions";
import {
  deleteUpload,
  readUpload,
  resolveUploadPath,
  safeFileName,
  saveUploadPath,
  uploadSchoolKey,
} from "../../lib/uploads";

const officeUser: AccessUser = {
  id: "user-office",
  name: "Office",
  email: "office@example.com",
  role: "ADMIN",
  roleName: "Admin",
  roleId: "role-admin",
  portal: "OFFICE",
  permissions: ["school.edit", "papers.upload", "fees.collect"],
  scopes: {},
  isSystemRole: true,
};

let uploadDirectory = "";
let originalDriver: string | undefined;
let originalDirectory: string | undefined;
let originalSchoolKey: string | undefined;

beforeEach(() => {
  originalDriver = process.env.UPLOADS_DRIVER;
  originalDirectory = process.env.UPLOADS_DIR;
  originalSchoolKey = process.env.ANEKIO_SCHOOL_KEY;
  uploadDirectory = mkdtempSync(join(tmpdir(), "anekio-uploads-"));
  process.env.UPLOADS_DRIVER = "local";
  process.env.UPLOADS_DIR = uploadDirectory;
  process.env.ANEKIO_SCHOOL_KEY = "Green Valley / Delhi";
});

afterEach(() => {
  if (originalDriver === undefined) delete process.env.UPLOADS_DRIVER;
  else process.env.UPLOADS_DRIVER = originalDriver;
  if (originalDirectory === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = originalDirectory;
  if (originalSchoolKey === undefined) delete process.env.ANEKIO_SCHOOL_KEY;
  else process.env.ANEKIO_SCHOOL_KEY = originalSchoolKey;
  rmSync(uploadDirectory, { recursive: true, force: true });
});

describe("upload storage boundaries", () => {
  it("treats only explicit public paths and legacy branding as public", () => {
    expect(resolveUploadPath("public/schools/demo/branding/logos/logo.png").publicFile).toBe(true);
    expect(resolveUploadPath("private/schools/demo/admissions/lead/birth.pdf").publicFile).toBe(false);
    expect(resolveUploadPath("school/logo.png").publicFile).toBe(true);
    expect(resolveUploadPath("school/admissions/birth.pdf").publicFile).toBe(false);
  });

  it("uses a stable sanitized school key and UUID object names", () => {
    expect(uploadSchoolKey()).toBe("green-valley-delhi");
    const name = safeFileName("Student Birth Certificate.PDF");
    expect(name).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(name).not.toContain("Student");
  });

  it("stores and reads local development files through the shared adapter", async () => {
    const rel = "private/schools/demo/admissions/submission/birth.pdf";
    await saveUploadPath(rel, Buffer.from("document"), "application/pdf");
    await expect(readUpload(rel)).resolves.toMatchObject({
      buf: Buffer.from("document"),
      type: "application/pdf",
    });
    await deleteUpload(rel);
    await expect(readUpload(rel)).rejects.toThrow();
  });
});

describe("upload intent validation", () => {
  it("creates record-scoped private exam and payment paths", () => {
    const question = prepareFileUpload(
      officeUser,
      { name: "question.pdf", mime: "application/pdf", size: 1200 },
      { kind: "question", examId: "exam-42" }
    );
    const receipt = prepareFileUpload(
      officeUser,
      { name: "proof.jpg", mime: "image/jpeg", size: 900 },
      { kind: "receipt", invoiceId: "invoice-7" }
    );
    expect(question.path).toMatch(/^private\/schools\/green-valley-delhi\/exams\/exam-42\/question-papers\/[0-9a-f-]{36}\.pdf$/);
    expect(receipt.path).toMatch(/^private\/schools\/green-valley-delhi\/fees\/invoice-7\/payment-proofs\/[0-9a-f-]{36}\.jpg$/);
  });

  it("separates public logos from private signatures and stamps", () => {
    const logo = prepareFileUpload(
      officeUser,
      { name: "logo.png", mime: "image/png", size: 500 },
      { kind: "school", asset: "logoPath" }
    );
    const signature = prepareFileUpload(
      officeUser,
      { name: "sign.png", mime: "image/png", size: 500 },
      { kind: "school", asset: "signPath" }
    );
    expect(logo.path).toContain("public/schools/green-valley-delhi/branding/logos/");
    expect(signature.path).toContain("private/schools/green-valley-delhi/branding/signatures/");
  });

  it("validates permissions, file types, sizes, and school asset kinds before upload", async () => {
    const user = { ...officeUser, permissions: [] };
    expect(() => prepareFileUpload(user, { name: "paper.pdf", mime: "application/pdf", size: 20 }, { kind: "question", examId: "exam" })).toThrow("No access");
    expect(() => prepareFileUpload(officeUser, { name: "logo.exe", mime: "application/octet-stream", size: 20 }, { kind: "school", asset: "logoPath" })).toThrow("PNG, JPEG, or WebP");
    expect(() => prepareFileUpload(officeUser, { name: "logo.html", mime: "image/png", size: 20 }, { kind: "school", asset: "logoPath" })).toThrow("PNG, JPEG, or WebP");
    expect(() => prepareFileUpload(officeUser, { name: "logo.png", mime: "image/png", size: 20 }, { kind: "school" })).toThrow("asset type required");
    expect(() => prepareFileUpload(officeUser, { name: "large.pdf", mime: "application/pdf", size: 13 * 1024 * 1024 }, { kind: "question", examId: "exam" })).toThrow("12 MB");
    await expect(preparePresignedFileUpload(officeUser, { name: "question.pdf", mime: "application/pdf", size: 20 }, { kind: "question", examId: "exam" })).resolves.toEqual({ direct: false });
    expect(prepareFileUpload(officeUser, { name: "question.pdf", mime: "application/octet-stream", size: 20 }, { kind: "question", examId: "exam" }).mime).toBe("application/pdf");
  });

  it("rejects invalid completion tokens", () => {
    expect(() => verifyUploadIntent(officeUser, "not-a-valid-token")).toThrow("invalid");
  });
});
