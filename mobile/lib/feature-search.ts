import type { NavItem } from "./api";
import { pathForNav } from "./paths";

type FeatureSearchMeta = {
  aliases: string[];
  hint: string;
};

export type FeatureSearchHit = {
  id: string;
  key: string;
  label: string;
  hint: string;
  href: string;
  score: number;
};

const FEATURE_SEARCH_INDEX: Record<string, FeatureSearchMeta> = {
  home: {
    hint: "Overview",
    aliases: ["dashboard", "desk", "home", "overview", "summary", "today"],
  },
  inbox: {
    hint: "Messages",
    aliases: ["inbox", "messages", "conversation", "query", "reply", "support"],
  },
  people: {
    hint: "Students",
    aliases: ["students", "student", "people", "admission no", "class", "roll", "guardian"],
  },
  admissions: {
    hint: "Admissions",
    aliases: ["admissions", "admission", "enquiry", "enquiries", "lead", "leads", "walk in", "follow up", "onboarding"],
  },
  staff: {
    hint: "Employees",
    aliases: ["employees", "employee", "staff", "teacher", "teachers", "hr", "salary"],
  },
  timetable: {
    hint: "Routine",
    aliases: ["routine", "timetable", "schedule", "period", "calendar", "class timing"],
  },
  fees: {
    hint: "Fees",
    aliases: ["fees", "fee", "payment", "payments", "invoice", "receipt", "dues", "collection"],
  },
  exams: {
    hint: "Exams",
    aliases: ["exams", "exam", "test", "marks", "marksheet", "result", "assessment"],
  },
  notices: {
    hint: "Notices",
    aliases: ["notices", "notice", "announcement", "bell", "notification", "circular"],
  },
  school: {
    hint: "Settings",
    aliases: ["settings", "school", "configuration", "config", "gateway", "payment gateway"],
  },
  subscription: {
    hint: "Subscription",
    aliases: ["subscription", "plan", "billing", "renewal"],
  },
  roles: {
    hint: "Permissions",
    aliases: ["roles", "permissions", "access", "staff access", "role"],
  },
  attendance: {
    hint: "Attendance",
    aliases: ["attendance", "present", "absent", "register", "mark attendance"],
  },
  class: {
    hint: "Class",
    aliases: ["class", "classroom", "students", "homework", "teacher class"],
  },
  leave: {
    hint: "Leave",
    aliases: ["leave", "absence", "holiday", "apply leave", "staff leave"],
  },
  subjects: {
    hint: "Courses",
    aliases: ["subjects", "subject", "courses", "course", "lessons"],
  },
  tests: {
    hint: "Examination",
    aliases: ["tests", "test", "examination", "marks", "result"],
  },
  papers: {
    hint: "Papers",
    aliases: ["papers", "paper", "question paper", "worksheet"],
  },
  path: {
    hint: "Learning path",
    aliases: ["path", "learning path", "progress", "plan"],
  },
  letter: {
    hint: "Letters",
    aliases: ["letter", "letters", "certificate", "document"],
  },
  uploads: {
    hint: "Uploads",
    aliases: ["uploads", "upload", "files", "documents"],
  },
  profile: {
    hint: "Account",
    aliases: ["profile", "account", "me", "password"],
  },
};

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function compact(value: string) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function stem(value: string) {
  const text = normalize(value);
  return text.length > 3 && text.endsWith("s") ? text.slice(0, -1) : text;
}

function scoreFeature(query: string, values: string[]) {
  let score = 0;
  const compactQuery = compact(query);
  const stemmedQuery = stem(query);
  for (const value of values) {
    const text = normalize(value);
    const compactText = compact(value);
    const stemmedText = stem(value);
    if (!text) continue;
    if (text === query) score = Math.max(score, 100);
    else if (text.startsWith(query)) score = Math.max(score, 80);
    else if (stemmedText === stemmedQuery) score = Math.max(score, 78);
    else if (compactText.startsWith(compactQuery)) score = Math.max(score, 72);
    else if (text.includes(query)) score = Math.max(score, 55);
    else if (compactText.includes(compactQuery)) score = Math.max(score, 45);
  }
  return score;
}

export function featureSearchHits(nav: NavItem[], query: string, limit = 6): FeatureSearchHit[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  return nav
    .map((item) => {
      const meta = FEATURE_SEARCH_INDEX[item.key];
      const values = [item.label, item.key, ...(meta?.aliases || [])];
      const score = scoreFeature(q, values);
      return {
        id: `f:${item.key}`,
        key: item.key,
        label: item.label,
        hint: meta?.hint || "Feature",
        href: pathForNav(item.key),
        score,
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
}
