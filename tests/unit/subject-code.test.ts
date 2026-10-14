import { describe, expect, it } from "vitest";
import {
  catalogCodeMatchesGrade,
  formatClassList,
  formatSubjectLabel,
  gradeSubjectCode,
  knownCodeForName,
  matchCatalogEntry,
  matchClassSubject,
  parseSubjectCatalog,
  serializeSubjectCatalog,
  skillMatchesSubject,
  validateSubjectCode,
} from "../../lib/subject-code";
import { formatSubjectLabel as mobileLabel } from "../../mobile/lib/subject-label";

describe("subject code validation", () => {
  it.each(["ENG", "MAT", "ENG-1", "ENG-L-012"])("accepts %s", (code) => {
    expect(validateSubjectCode(code).ok).toBe(true);
    expect(validateSubjectCode(code).code).toBe(code);
  });

  it.each(["E", "ENG 1", "ENG!", "ENG--1", "-ENG", "ENG-"])("rejects %s", (code) => {
    expect(validateSubjectCode(code).ok).toBe(false);
  });

  it("uppercases codes", () => {
    expect(validateSubjectCode("eng").code).toBe("ENG");
    expect(validateSubjectCode("eng-l-012").code).toBe("ENG-L-012");
  });

  it("keeps class 1 codes and suffixes later grades", () => {
    expect(gradeSubjectCode("ENG", "1")).toBe("ENG");
    expect(gradeSubjectCode("eng", "2")).toBe("ENG-2");
    expect(formatClassList(["1-A", "1-B", "2-A"])).toBe("1-A, 1-B and 2-A");
  });

  it("matches catalog codes to the grade they were coded for", () => {
    expect(catalogCodeMatchesGrade("SAN-5", "5")).toBe(true);
    expect(catalogCodeMatchesGrade("SAN-5", "6")).toBe(false);
    expect(catalogCodeMatchesGrade("ENG", "1")).toBe(true);
    expect(catalogCodeMatchesGrade("ENG", "5")).toBe(false);
    expect(catalogCodeMatchesGrade("ENG-2", "2")).toBe(true);
  });
});

describe("subject labels", () => {
  it("formats CODE · Name", () => {
    expect(formatSubjectLabel("ENG", "English")).toBe("ENG · English");
    expect(mobileLabel("ENG", "English")).toBe("ENG · English");
  });

  it("falls back to name when code is missing", () => {
    expect(formatSubjectLabel("", "English")).toBe("English");
  });
});

describe("legacy catalog and names", () => {
  it("maps known names", () => {
    expect(knownCodeForName("English")).toBe("ENG");
    expect(knownCodeForName("Mathematics")).toBe("MAT");
  });

  it("parses legacy string catalogs into objects", () => {
    const catalog = parseSubjectCatalog(JSON.stringify(["English", "Mathematics", "Hindi"]));
    expect(catalog).toEqual([
      { code: "ENG", name: "English" },
      { code: "MAT", name: "Mathematics" },
      { code: "HIN", name: "Hindi" },
    ]);
  });

  it("rejects duplicate catalog codes but allows the same name with a different code", () => {
    expect(() => serializeSubjectCatalog([{ code: "ENG", name: "English" }, { code: "ENG", name: "English 2" }])).toThrow(
      /already in the catalog/
    );
    expect(
      serializeSubjectCatalog([
        { code: "ENG", name: "English" },
        { code: "ENG-2", name: "English" },
      ])
    ).toBe(JSON.stringify([
      { code: "ENG", name: "English" },
      { code: "ENG-2", name: "English" },
    ]));
    expect(matchCatalogEntry([{ code: "HIN", name: "Hindi" }, { code: "HIN-5", name: "Hindi" }], { code: "HIN-5", name: "Hindi" })?.code).toBe("HIN-5");
    expect(matchCatalogEntry([{ code: "HIN", name: "Hindi" }, { code: "HIN-5", name: "Hindi" }], { name: "Hindi" })).toBeNull();
  });
});

describe("TeacherSkill matching", () => {
  it("matches code first and name as fallback", () => {
    expect(skillMatchesSubject("ENG", { code: "ENG", name: "English" })).toBe(true);
    expect(skillMatchesSubject("English", { code: "ENG", name: "English" })).toBe(true);
    expect(skillMatchesSubject("Hindi", { code: "ENG", name: "English" })).toBe(false);
  });
});

describe("class subject matching", () => {
  const rows = [
    { id: "s-eng", code: "ENG", name: "English" },
    { id: "s-mat", code: "MAT", name: "Mathematics" },
  ];

  it("resolves by id, then code, then skill name", () => {
    expect(matchClassSubject(rows, { subjectId: "s-mat" })?.id).toBe("s-mat");
    expect(matchClassSubject(rows, { code: "ENG" })?.id).toBe("s-eng");
    expect(matchClassSubject(rows, { subjectName: "English" })?.id).toBe("s-eng");
  });

  it("does not invent a subject from an unknown skill name", () => {
    expect(matchClassSubject(rows, { subjectName: "Biology" })).toBeNull();
  });
});
