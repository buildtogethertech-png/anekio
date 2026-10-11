import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { previewDocumentTemplateCore } from "../../lib/document-studio";
import type { AccessUser } from "../../lib/permissions";
import { saveUploadPath } from "../../lib/uploads";

const officeUser: AccessUser = {
  id: "document-preview-user",
  role: "ADMIN",
  roleName: "Admin",
  roleId: "admin-role",
  portal: "OFFICE",
  permissions: ["school.edit"],
  scopes: {},
  isSystemRole: true,
};

const originalUploadsDir = process.env.UPLOADS_DIR;
const originalUploadsDriver = process.env.UPLOADS_DRIVER;
let uploadsDir = "";

afterEach(() => {
  if (originalUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = originalUploadsDir;
  if (originalUploadsDriver === undefined) delete process.env.UPLOADS_DRIVER;
  else process.env.UPLOADS_DRIVER = originalUploadsDriver;
  if (uploadsDir) rmSync(uploadsDir, { recursive: true, force: true });
  uploadsDir = "";
});

describe("document template assets", () => {
  it("renders school logo, signature, and stamp from saved uploads", async () => {
    uploadsDir = mkdtempSync(join(tmpdir(), "anekio-document-assets-"));
    process.env.UPLOADS_DIR = uploadsDir;
    process.env.UPLOADS_DRIVER = "local";
    const logoPath = "public/school/branding/logos/logo.png";
    const signPath = "private/school/branding/signatures/sign.png";
    const stampPath = "private/school/branding/stamps/stamp.png";
    await saveUploadPath(logoPath, Buffer.from("logo"), "image/png");
    await saveUploadPath(signPath, Buffer.from("sign"), "image/png");
    await saveUploadPath(stampPath, Buffer.from("stamp"), "image/png");

    const html = await previewDocumentTemplateCore(officeUser, {
      layout: {
        elements: [
          { id: "logo", type: "IMAGE", field: "school.logoPath", label: "Logo", x: 5, y: 5, width: 10, height: 10 },
          { id: "sign", type: "SIGNATURE", field: "school.signPath", label: "Signature", x: 20, y: 5, width: 10, height: 10 },
          { id: "stamp", type: "STAMP", field: "school.stampPath", label: "Stamp", x: 35, y: 5, width: 10, height: 10 },
        ],
      },
      data: { school: { logoPath, signPath, stampPath } },
    });

    expect(html).toMatch(/src="[^"]+\/api\/files\/public\/school\/branding\/logos\/logo\.png"/);
    expect(html).toContain('src="data:image/png;base64,c2lnbg=="');
    expect(html).toContain('src="data:image/png;base64,c3RhbXA="');
    expect(html).not.toContain("[object Promise]");
  });
});
