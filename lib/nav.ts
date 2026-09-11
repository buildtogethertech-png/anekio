export type NavItem = {
  href: string;
  label: string;
  group: "Reports" | "Applications";
  permission?: string;
  key: string;
};

const OFFICE_NAV: NavItem[] = [
  { key: "home", href: "/admin/reports", label: "Dashboard", group: "Reports", permission: "desk.view" },
  { key: "onboarding", href: "/admin/reports/onboarding", label: "School setup", group: "Reports", permission: "onboarding.manage" },
  { key: "inbox", href: "/admin/reports/inbox", label: "Inbox", group: "Reports", permission: "inbox.view" },
  { key: "people", href: "/admin/reports/people", label: "Students", group: "Reports", permission: "people.view" },
  { key: "admissions", href: "/admin/reports/admissions", label: "Admissions", group: "Reports", permission: "admissions.view" },
  { key: "staff", href: "/admin/reports/staff", label: "Employees", group: "Reports", permission: "staff.view" },
  { key: "timetable", href: "/admin/reports/timetable", label: "Routine", group: "Reports", permission: "timetable.view" },
  { key: "fees", href: "/admin/reports/fees", label: "Fees", group: "Reports", permission: "fees.view" },
  { key: "exams", href: "/admin/reports/exams", label: "Exams", group: "Reports", permission: "exams.view" },
  { key: "notices", href: "/admin/reports/notices", label: "Notices", group: "Reports", permission: "notices.view" },
  { key: "school", href: "/admin/reports/school", label: "Settings", group: "Reports", permission: "school.edit" },
  { key: "subscription", href: "/admin/reports/subscription", label: "Manage subscription", group: "Reports", permission: "school.edit" },
  { key: "roles", href: "/admin/reports/roles", label: "Roles & permissions", group: "Reports", permission: "roles.manage" },
];

const TEACHER_NAV: NavItem[] = [
  { key: "home", href: "/teacher/reports", label: "Dashboard", group: "Reports", permission: "attendance.mark" },
  { key: "inbox", href: "/teacher/reports/inbox", label: "Inbox", group: "Reports", permission: "inbox.view" },
  { key: "notices", href: "/teacher/reports/notices", label: "Notices", group: "Reports", permission: "attendance.mark" },
  { key: "attendance", href: "/teacher/reports/roster", label: "Attendance", group: "Reports", permission: "attendance.mark" },
  { key: "class", href: "/teacher/reports/class", label: "Class", group: "Reports", permission: "class.view" },
  { key: "leave", href: "/teacher/reports/leave", label: "Leave", group: "Reports", permission: "leave.apply" },
  { key: "exams", href: "/teacher/reports/exams", label: "Exams", group: "Reports", permission: "exams.teach" },
  { key: "timetable", href: "/teacher/reports/timetable", label: "Timetable", group: "Reports", permission: "timetable.teach" },
];

const PARENT_NAV: NavItem[] = [
  { key: "home", href: "/parent/reports", label: "Dashboard", group: "Reports", permission: "children.view" },
  { key: "inbox", href: "/parent/reports/inbox", label: "Inbox", group: "Reports", permission: "inbox.view" },
  { key: "notices", href: "/parent/reports/notices", label: "Notices", group: "Reports", permission: "children.view" },
  { key: "attendance", href: "/parent/reports/attendance", label: "Attendance", group: "Reports", permission: "children.view" },
  { key: "timetable", href: "/parent/reports/timetable", label: "Timetable", group: "Reports", permission: "children.view" },
  { key: "fees", href: "/parent/reports/fees", label: "Fees", group: "Reports", permission: "fees.pay" },
  { key: "tests", href: "/parent/reports/tests", label: "Examination", group: "Reports", permission: "children.view" },
  { key: "profile", href: "/parent/reports/profile", label: "Profile", group: "Reports", permission: "children.view" },
];

const STUDENT_NAV: NavItem[] = [
  { key: "home", href: "/student/reports", label: "Today", group: "Reports", permission: "self.view" },
  { key: "notices", href: "/student/reports/notices", label: "Notices", group: "Reports", permission: "self.view" },
  { key: "attendance", href: "/student/reports/attendance", label: "Attendance", group: "Reports", permission: "self.view" },
  { key: "subjects", href: "/student/reports/subjects", label: "Courses", group: "Reports", permission: "self.view" },
  { key: "tests", href: "/student/reports/tests", label: "Examination", group: "Reports", permission: "self.view" },
  { key: "papers", href: "/student/reports/papers", label: "Papers", group: "Reports", permission: "self.view" },
  { key: "path", href: "/student/reports/path", label: "Path", group: "Reports", permission: "self.view" },
  { key: "timetable", href: "/student/reports/timetable", label: "Timetable", group: "Reports", permission: "self.view" },
  { key: "fees", href: "/student/reports/fees", label: "Fees", group: "Reports", permission: "fees.pay" },
  { key: "profile", href: "/student/reports/profile", label: "Profile", group: "Reports", permission: "self.view" },
];

export function navForPortal(portal: string, permissions: string[]): NavItem[] {
  const all =
    portal === "OFFICE"
      ? OFFICE_NAV
      : portal === "TEACHER"
        ? TEACHER_NAV
        : portal === "PARENT"
          ? PARENT_NAV
          : STUDENT_NAV;
  return all.filter((item) => !item.permission || permissions.includes(item.permission));
}

/** @deprecated use navForPortal */
export function navFor(role: string, permissions: string[] = []): NavItem[] {
  if (role === "PARENT")
    return navForPortal("PARENT", permissions.length ? permissions : PARENT_NAV.map((i) => i.permission!).filter(Boolean));
  if (role === "TEACHER")
    return navForPortal("TEACHER", permissions.length ? permissions : TEACHER_NAV.map((i) => i.permission!).filter(Boolean));
  if (role === "STUDENT")
    return navForPortal("STUDENT", permissions.length ? permissions : STUDENT_NAV.map((i) => i.permission!).filter(Boolean));
  return navForPortal("OFFICE", permissions);
}

export function publicNav(item: NavItem) {
  return { key: item.key, label: item.label, permission: item.permission ?? null };
}
