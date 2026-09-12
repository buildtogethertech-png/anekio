import { describe, expect, it } from "vitest";
import { issuedQrUrl, issuedScanTokenFromUrl } from "../../lib/document-studio";

describe("issued document QR URLs", () => {
  it("maps student ID cards to an opaque attendance scan token, not the student id", () => {
    const verifyUrl = "http://localhost:4000/verify/opaque-token-value-123456";
    expect(issuedQrUrl("STUDENT_ID", verifyUrl)).toBe("http://localhost:4000/attendance/scan/opaque-token-value-123456");
    expect(issuedQrUrl("STUDENT_ID", verifyUrl)).not.toContain("student-anaya");
    expect(issuedQrUrl("EMPLOYEE_ID", verifyUrl)).toBe("http://localhost:4000/staff/scan/opaque-token-value-123456");
    expect(issuedQrUrl("REPORT_CARD", verifyUrl)).toBe(verifyUrl);
  });

  it("reads tokens from attendance, staff, verify and document URLs", () => {
    expect(issuedScanTokenFromUrl("http://localhost:4000/attendance/scan/abc_DEF-123")).toBe("abc_DEF-123");
    expect(issuedScanTokenFromUrl("https://school.example/staff/scan/staffTok")).toBe("staffTok");
    expect(issuedScanTokenFromUrl("/verify/docTok")).toBe("docTok");
    expect(issuedScanTokenFromUrl("https://x.test/documents/docTok?x=1")).toBe("docTok");
    expect(issuedScanTokenFromUrl("student-anaya")).toBe("");
  });

  it("keeps designer preview on the sample host so a real student QR is not baked into the template", () => {
    expect(issuedQrUrl("STUDENT_ID", "https://verify.anekio.example/preview")).toBe(
      "https://verify.anekio.example/attendance/scan/preview"
    );
  });
});
