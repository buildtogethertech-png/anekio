import { describe, expect, it } from "vitest";
import {
  catalogCodeMatchesGrade,
  formatClassList,
  formatSubjectLabel,
  gradeSubjectCode,
  knownCodeForName,
  matchCatalogEntry,
  matchClassSubject,
  isBakedDefaultCatalog,
  labeledTeacherSkills,
  parseSubjectCatalog,
  resolveSkillLabel,
  serializeSubjectCatalog,
  skillMatchesSubject,
  validateSubjectCode,
} from "../../lib/subject-code";
import {
  formatSubjectLabel as mobileLabel,
  labeledTeacherSkills as mobileLabeledSkills,
  resolveSkillLabel as mobileResolveSkill,
} from "../../mobile/lib/subject-label";

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
  it("shows the subject name", () => {
    expect(formatSubjectLabel("ENG", "English")).toBe("English");
    expect(mobileLabel("ENG", "English")).toBe("English");
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

  it("keeps an empty catalog empty for a new school", () => {
    expect(parseSubjectCatalog("[]")).toEqual([]);
    expect(parseSubjectCatalog("")).toEqual([]);
    expect(parseSubjectCatalog(null)).toEqual([]);
    expect(parseSubjectCatalog("not-json")).toEqual([]);
  });

  it("detects the unused starter catalog", () => {
    expect(isBakedDefaultCatalog(parseSubjectCatalog(JSON.stringify([
      { code: "ENG", name: "English" },
      { code: "MAT", name: "Mathematics" },
      { code: "SCI", name: "Science" },
      { code: "HIN", name: "Hindi" },
      { code: "SST", name: "Social Studies" },
      { code: "CSC", name: "Computer" },
      { code: "ART", name: "Art" },
      { code: "PED", name: "Physical Education" },
    ])))).toBe(true);
    expect(isBakedDefaultCatalog([{ code: "ENG", name: "English" }])).toBe(false);
  });

  it("rejects duplicate catalog names", () => {
    expect(() => serializeSubjectCatalog([{ code: "ENG", name: "English" }, { code: "ENG-2", name: "English" }])).toThrow(
      /already in the catalog/
    );
    expect(serializeSubjectCatalog([{ code: "ENG", name: "English" }, { code: "HIN", name: "Hindi" }])).toBe(
      JSON.stringify([{ name: "English" }, { name: "Hindi" }])
    );
    expect(matchCatalogEntry([{ code: "HIN", name: "Hindi" }], { name: "Hindi" })?.name).toBe("Hindi");
  });
});

describe("TeacherSkill matching", () => {
  it("matches name and still accepts a stored code", () => {
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

describe("teacher skill labels after a catalog rename", () => {
  const class10 = {
    id: "class-10-a",
    subjects: [
      { id: "s-art", code: "ART", name: "Art" },
      { id: "s-kho", code: "KHORTHABCDEF", name: "Khortha" },
    ],
  };

  it("shows the current subject name when the skill still holds the old code or name", () => {
    expect(resolveSkillLabel("KHORTHABCDEF", class10.subjects)).toBe("Khortha");
    expect(resolveSkillLabel("Khortha", class10.subjects)).toBe("Khortha");
    expect(mobileResolveSkill("KHORTHABCDEF", class10.subjects)).toBe("Khortha");
  });

  it("relabels leftover codes on the teacher board", () => {
    const skills = labeledTeacherSkills(
      [
        { subjectName: "ART", classId: "class-10-a" },
        { subjectName: "KHORTHABCDEF", classId: "class-10-a" },
      ],
      [class10]
    );
    expect(skills.map((row) => row.subjectName)).toEqual(["Art", "Khortha"]);
    expect(
      mobileLabeledSkills(
        [
          { subjectName: "ART", classId: "class-10-a" },
          { subjectName: "KHORTHABCDEF", classId: "class-10-a" },
        ],
        [class10]
      ).map((row) => row.subjectName)
    ).toEqual(["Art", "Khortha"]);
  });

  it("uses the catalog name when the class list is empty", () => {
    expect(resolveSkillLabel("ENG", [], [{ code: "ENG", name: "English" }])).toBe("English");
  });
});
