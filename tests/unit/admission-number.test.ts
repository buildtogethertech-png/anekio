import { describe, expect, it } from "vitest";
import { cleanAdmissionFormat, formatAdmissionNo, patternOf, planNextAdmissionNo, serialOf } from "../../lib/admission-number";

const none = { format: "", digits: 0, floor: 0 };

describe("serialOf", () => {
  it("takes the last group of digits", () => {
    expect(serialOf("ADM-0226")).toBe(226);
    expect(serialOf("2024/1532")).toBe(1532);
    expect(serialOf("500")).toBe(500);
    expect(serialOf("ABC")).toBeNull();
  });
});

describe("planNextAdmissionNo", () => {
  it("continues after the highest serial without filling gaps", () => {
    expect(planNextAdmissionNo(["1", "3", "5", "7", "10"], none, 2026).admissionNo).toBe("11");
  });
  it("copies the look of the last number", () => {
    expect(planNextAdmissionNo(["ADM-226", "ADM-500", "ADM-12"], none, 2026).admissionNo).toBe("ADM-501");
    expect(planNextAdmissionNo(["ADM-0042"], none, 2026).admissionNo).toBe("ADM-0043");
    expect(planNextAdmissionNo(["2024/1532"], none, 2026).admissionNo).toBe("2024/1533");
  });
  it("ignores prefixes when finding the highest", () => {
    expect(planNextAdmissionNo(["ADM-226", "300", "SPS/250"], none, 2026).admissionNo).toBe("301");
  });
  it("starts a brand-new school at ADM-0001", () => {
    expect(planNextAdmissionNo([], none, 2026).admissionNo).toBe("ADM-0001");
  });
  it("uses the school's format and padding", () => {
    expect(planNextAdmissionNo(["500"], { format: "SPS/{YYYY}/{N}", digits: 4, floor: 0 }, 2026).admissionNo).toBe("SPS/2026/0501");
    expect(planNextAdmissionNo(["500"], { format: "SPS/{YY}-{N}", digits: 0, floor: 0 }, 2026).admissionNo).toBe("SPS/26-501");
  });
  it("respects the floor but never goes back", () => {
    expect(planNextAdmissionNo(["ADM-500"], { format: "", digits: 0, floor: 1001 }, 2026).admissionNo).toBe("ADM-1001");
    expect(planNextAdmissionNo(["ADM-500"], { format: "", digits: 0, floor: 100 }, 2026).admissionNo).toBe("ADM-501");
  });
  it("skips a number that is already taken in another look", () => {
    const taken = new Set(["ADM-501", "ADM-500"]);
    expect(planNextAdmissionNo(["ADM-500"], none, 2026, taken).admissionNo).toBe("ADM-502");
  });
});

describe("format helpers", () => {
  it("adds {N} when missing and fills tokens", () => {
    expect(cleanAdmissionFormat("SPS/")).toBe("SPS/{N}");
    expect(formatAdmissionNo("SPS/{YYYY}/{N}", 7, 3, 2026)).toBe("SPS/2026/007");
    expect(patternOf("12/A")).toEqual({ format: "{N}/A", digits: 2 });
  });
});
