export const PORTAL_PATH: Record<string, string> = {
  home: "/",
  notices: "/notices",
  inbox: "/inbox",
  people: "/people",
  admissions: "/admissions",
  staff: "/staff",
  school: "/school",
  timetable: "/timetable",
  fees: "/fees",
  exams: "/exams",
  roles: "/roles",
  subscription: "/subscription",
  attendance: "/attendance",
  class: "/class",
  leave: "/leave",
  subjects: "/subjects",
  tests: "/tests",
  papers: "/papers",
  path: "/path",
  letter: "/letter",
  uploads: "/uploads",
  profile: "/profile",
};

export const HIDDEN_TAB_SCREENS = [
  "people",
  "inbox",
  "admissions",
  "staff",
  "school",
  "timetable",
  "fees",
  "exams",
  "roles",
  "subscription",
  "attendance",
  "class",
  "leave",
  "subjects",
  "tests",
  "papers",
  "path",
  "letter",
  "uploads",
  "profile",
] as const;

export function pathForNav(key: string) {
  return PORTAL_PATH[key] || "/";
}

/** Staff exams workspace vs family Examination. Parents use /tests, not /exams. */
export function examsScreenForKind(kind: string) {
  if (kind === "OFFICE") return "office" as const;
  if (kind === "TEACHER") return "teacher" as const;
  if (kind === "PARENT") return "denied" as const;
  return "family-tests" as const;
}

export function testsScreenForKind(kind: string) {
  return kind === "PARENT" ? ("parent-examination" as const) : ("family-tests" as const);
}
