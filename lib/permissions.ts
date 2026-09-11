export type Portal = "OFFICE" | "TEACHER" | "PARENT" | "STUDENT";
export const ACCESS_SCOPES = ["SELF", "ASSIGNED", "REPORTS", "SCHOOL"] as const;
export type AccessScope = (typeof ACCESS_SCOPES)[number];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export type PermissionDef = {
  key: string;
  group: string;
  label: string;
  hint: string;
  portals: Portal[];
  see?: boolean;
};

/** Catalog is code. Roles in the DB only store which keys are on. New screens = new row here, then they show up on the Roles tab. */
export const PERMISSIONS = [
  { key: "desk.view", group: "Dashboard", label: "See dashboard", hint: "Office home after login", portals: ["OFFICE"], see: true },
  { key: "people.view", group: "Students", label: "See students", hint: "Find students and families", portals: ["OFFICE"], see: true },
  { key: "people.edit", group: "Students", label: "Add and edit records", hint: "Students, parents, teachers", portals: ["OFFICE"] },
  { key: "people.import", group: "Students", label: "Import from sheet", hint: "CSV / Excel upload", portals: ["OFFICE"] },
  { key: "inbox.view", group: "Inbox", label: "See inbox", hint: "Parent-school messages, replies, assignments, and closures", portals: ["OFFICE", "TEACHER", "PARENT"], see: true },
  { key: "inbox.manage", group: "Inbox", label: "Reply in inbox", hint: "Respond to messages and update threads", portals: ["OFFICE", "TEACHER", "PARENT"] },
  { key: "admissions.view", group: "Admissions", label: "See admission leads", hint: "Website enquiries, follow-ups, and lead details", portals: ["OFFICE"], see: true },
  { key: "admissions.manage", group: "Admissions", label: "Manage admission leads", hint: "Call, WhatsApp, add remarks, schedule tests, dispose, and admit", portals: ["OFFICE"] },
  { key: "staff.view", group: "Employees", label: "See employees", hint: "Teachers and office staff", portals: ["OFFICE"], see: true },
  { key: "staff.edit", group: "Employees", label: "Add employees and mark attendance", hint: "Teachers, staff, attendance", portals: ["OFFICE"] },
  { key: "leave.decide", group: "Employees", label: "Decide employee leave", hint: "Review leave within the selected access scope", portals: ["OFFICE", "TEACHER"] },
  { key: "school.edit", group: "School settings", label: "Edit school settings", hint: "Letterhead, classes, calendar, sessions, pay, messages", portals: ["OFFICE"], see: true },
  { key: "subscription.manage", group: "School settings", label: "Manage subscription", hint: "Plan, renewal, and Anekio invoices", portals: ["OFFICE"], see: true },
  { key: "documents.view", group: "Documents", label: "See document templates", hint: "Templates and issued-document register", portals: ["OFFICE"], see: true },
  { key: "documents.design", group: "Documents", label: "Design templates", hint: "Create and edit document layouts", portals: ["OFFICE"] },
  { key: "documents.publish", group: "Documents", label: "Publish templates", hint: "Make a template active for issuing", portals: ["OFFICE"] },
  { key: "documents.issue", group: "Documents", label: "Issue documents", hint: "Generate, print, download, and share", portals: ["OFFICE"] },
  { key: "documents.batch", group: "Documents", label: "Issue document batches", hint: "Generate documents for a class or group", portals: ["OFFICE"] },
  { key: "documents.revoke", group: "Documents", label: "Revoke issued documents", hint: "Change verification status with a reason", portals: ["OFFICE"] },
  { key: "timetable.view", group: "Routine", label: "See routine", hint: "Timetable", portals: ["OFFICE", "TEACHER"], see: true },
  { key: "timetable.edit", group: "Routine", label: "Edit routine", hint: "Periods, rooms, slots", portals: ["OFFICE"] },
  { key: "fees.view", group: "Fees", label: "See fees", hint: "Dues, invoices, collection", portals: ["OFFICE", "TEACHER"], see: true },
  { key: "fees.collect", group: "Fees", label: "Collect fees", hint: "Cash, UPI, receipts", portals: ["OFFICE"] },
  { key: "fees.remind", group: "Fees", label: "Send reminders", hint: "WhatsApp / email due notices", portals: ["OFFICE"] },
  { key: "fees.configure", group: "Fees", label: "Edit fee templates", hint: "Class fee structure and late rules", portals: ["OFFICE"] },
  { key: "exams.view", group: "Exams", label: "See exams", hint: "Series, marks, papers", portals: ["OFFICE"], see: true },
  { key: "exams.edit", group: "Exams", label: "Run exams", hint: "Create series, set papers, grade policy", portals: ["OFFICE"] },
  { key: "marks.enter", group: "Exams", label: "Enter marks", hint: "Fill marksheets", portals: ["OFFICE", "TEACHER"] },
  { key: "papers.upload", group: "Exams", label: "Upload papers", hint: "Question paper and copies", portals: ["OFFICE", "TEACHER"] },
  { key: "exams.publish", group: "Exams", label: "Publish results", hint: "Lock and share report cards", portals: ["OFFICE"] },
  { key: "roles.manage", group: "Roles", label: "Roles and access", hint: "Who can see what", portals: ["OFFICE"], see: true },
  { key: "notices.view", group: "Notices", label: "See notices", hint: "Circulars on the board", portals: ["OFFICE"], see: true },
  { key: "notices.publish", group: "Notices", label: "Post notices", hint: "Pick who and which class", portals: ["OFFICE"] },
  { key: "attendance.mark", group: "Teaching", label: "Mark attendance", hint: "Own classes", portals: ["TEACHER"], see: true },
  { key: "exams.teach", group: "Teaching", label: "See own exams", hint: "Papers assigned to this teacher", portals: ["TEACHER"], see: true },
  { key: "timetable.teach", group: "Teaching", label: "See own routine", hint: "Routine for this teacher", portals: ["TEACHER"], see: true },
  { key: "leave.apply", group: "Teaching", label: "Apply leave", hint: "Own planned and sick leave", portals: ["TEACHER"], see: true },
  { key: "class.view", group: "Teaching", label: "See own class", hint: "Class teacher section: call, WhatsApp, notes", portals: ["TEACHER"], see: true },
  { key: "children.view", group: "Family", label: "See own children", hint: "Attendance, tests, papers, path", portals: ["PARENT"], see: true },
  { key: "fees.pay", group: "Family", label: "Pay fees", hint: "Own invoices", portals: ["PARENT", "STUDENT"] },
  { key: "self.view", group: "Student", label: "See own record", hint: "Today, courses, attendance, tests, papers, timetable, profile", portals: ["STUDENT"], see: true },
] as const satisfies readonly PermissionDef[];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export const LOCKED_KEYS = ["roles.manage"] as const;

export type AccessUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: string;
  roleName: string;
  roleId: string;
  portal: Portal;
  permissions: string[];
  scopes: Record<string, AccessScope>;
  isSystemRole: boolean;
};

export const PORTAL_HOME: Record<Portal, string> = {
  OFFICE: "/admin/reports",
  TEACHER: "/teacher/reports",
  PARENT: "/parent/reports",
  STUDENT: "/student/reports",
};

export const PORTAL_PREFIX: Record<Portal, string> = {
  OFFICE: "/admin",
  TEACHER: "/teacher",
  PARENT: "/parent",
  STUDENT: "/student",
};

export function can(user: { permissions: string[] } | null | undefined, key: string) {
  return Boolean(user?.permissions.includes(key));
}

const REPORTING_SCOPES = ["REPORTS", "SCHOOL"] as const;

export function scopePolicyFor(
  permission: string,
  portal?: Portal
): { scopes: readonly AccessScope[]; defaultScope: AccessScope } {
  if (permission === "leave.decide" && portal === "TEACHER") {
    return { scopes: ["REPORTS"], defaultScope: "REPORTS" };
  }
  if (permission === "timetable.view" && portal === "TEACHER") {
    return { scopes: ["REPORTS"], defaultScope: "REPORTS" };
  }
  if (["leave.decide", "timetable.view", "timetable.edit"].includes(permission)) {
    return { scopes: REPORTING_SCOPES, defaultScope: "REPORTS" };
  }
  if (["leave.apply", "children.view", "fees.pay", "self.view"].includes(permission)) {
    return { scopes: ["SELF"], defaultScope: "SELF" };
  }
  if (
    [
      "attendance.mark",
      "exams.teach",
      "timetable.teach",
      "class.view",
      "marks.enter",
      "papers.upload",
    ].includes(permission)
  ) {
    return { scopes: ["ASSIGNED"], defaultScope: "ASSIGNED" };
  }
  return { scopes: ["SCHOOL"], defaultScope: "SCHOOL" };
}

export function validScopeFor(permission: string, scope: string, portal?: Portal): scope is AccessScope {
  return scopePolicyFor(permission, portal).scopes.includes(scope as AccessScope);
}

export function scopeFor(user: Pick<AccessUser, "scopes" | "portal"> | null | undefined, permission: string): AccessScope {
  return user?.scopes?.[permission] ?? scopePolicyFor(permission, user?.portal).defaultScope;
}

export function permissionsForPortal(portal: Portal) {
  return PERMISSIONS.filter((p) => (p.portals as readonly string[]).includes(portal));
}

export function defaultGrants(slug: string): string[] {
  if (slug === "ADMIN") return PERMISSION_KEYS.slice();
  if (slug === "FEES") {
    return ["desk.view", "people.view", "fees.view", "fees.collect", "fees.remind", "fees.configure", "documents.view", "documents.issue", "documents.batch"];
  }
  if (slug === "ADMISSIONS") {
    return ["desk.view", "people.view", "admissions.view", "admissions.manage", "inbox.view", "inbox.manage", "notices.view"];
  }
  if (slug === "EXAMS") {
    return [
      "desk.view",
      "people.view",
      "exams.view",
      "exams.edit",
      "exams.publish",
      "timetable.view",
      "papers.upload",
      "marks.enter",
      "documents.view",
      "documents.issue",
      "documents.batch",
    ];
  }
  if (slug === "TEACHER") {
    return [
      "attendance.mark",
      "exams.teach",
      "papers.upload",
      "marks.enter",
      "timetable.teach",
      "leave.apply",
      "leave.decide",
      "class.view",
      "inbox.view",
      "inbox.manage",
    ];
  }
  if (slug === "PARENT") return ["children.view", "fees.pay", "inbox.view", "inbox.manage"];
  if (slug === "STUDENT") return ["self.view", "fees.pay"];
  return ["desk.view"];
}

export const SYSTEM_ROLES: {
  slug: string;
  name: string;
  portal: Portal;
  description: string;
}[] = [
  { slug: "ADMIN", name: "Admin", portal: "OFFICE", description: "Principal / owner. Everything." },
  { slug: "ADMISSIONS", name: "Admissions", portal: "OFFICE", description: "Admission team. Leads, follow-ups, calls and enquiries." },
  { slug: "FEES", name: "Fees", portal: "OFFICE", description: "Fee collector. Dues, receipts, reminders." },
  { slug: "EXAMS", name: "Exams", portal: "OFFICE", description: "Exam controller. Papers, marks, report cards." },
  { slug: "TEACHER", name: "Teacher", portal: "TEACHER", description: "Own classes only." },
  { slug: "PARENT", name: "Parent", portal: "PARENT", description: "Own children only." },
  { slug: "STUDENT", name: "Student", portal: "STUDENT", description: "Own record only." },
];
