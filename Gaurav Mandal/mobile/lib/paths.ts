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
