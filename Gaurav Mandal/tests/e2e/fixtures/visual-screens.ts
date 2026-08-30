import type { Portal } from "./accounts";

export type VisualPriority = "p0" | "p1";

export type VisualScreen = {
  key: string;
  path: string;
  priority: VisualPriority;
  readyText?: string;
};

export type PortalVisualMatrix = {
  portal: Portal;
  screens: VisualScreen[];
};

export const portalVisualMatrix: PortalVisualMatrix[] = [
  {
    portal: "OFFICE",
    screens: [
      { key: "home", path: "/", priority: "p0" },
      { key: "people", path: "/people", priority: "p0" },
      { key: "staff", path: "/staff", priority: "p0" },
      { key: "school", path: "/school", priority: "p1" },
      { key: "timetable", path: "/timetable", priority: "p1" },
      { key: "fees", path: "/fees", priority: "p0" },
      { key: "exams", path: "/exams", priority: "p1" },
      { key: "notices", path: "/notices", priority: "p1", readyText: "Fixture circular" },
      { key: "roles", path: "/roles", priority: "p1" },
      { key: "more", path: "/more", priority: "p1" },
      {
        key: "notifications",
        path: "/notifications",
        priority: "p1",
        readyText: "Fixture circular",
      },
    ],
  },
  {
    portal: "TEACHER",
    screens: [
      { key: "home", path: "/", priority: "p0" },
      { key: "notices", path: "/notices", priority: "p1", readyText: "Fixture circular" },
      { key: "attendance", path: "/attendance", priority: "p0" },
      { key: "class", path: "/class", priority: "p0" },
      { key: "leave", path: "/leave", priority: "p1" },
      { key: "exams", path: "/exams", priority: "p0" },
      { key: "timetable", path: "/timetable", priority: "p1" },
      { key: "more", path: "/more", priority: "p1" },
      {
        key: "notifications",
        path: "/notifications",
        priority: "p1",
        readyText: "Fixture circular",
      },
    ],
  },
  {
    portal: "PARENT",
    screens: [
      { key: "home", path: "/", priority: "p0" },
      { key: "notices", path: "/notices", priority: "p1", readyText: "Fixture circular" },
      { key: "attendance", path: "/attendance", priority: "p1" },
      { key: "subjects", path: "/subjects", priority: "p1" },
      { key: "tests", path: "/tests", priority: "p1" },
      { key: "papers", path: "/papers", priority: "p1" },
      { key: "path", path: "/path", priority: "p1" },
      { key: "letter", path: "/letter", priority: "p1" },
      { key: "timetable", path: "/timetable", priority: "p1" },
      { key: "fees", path: "/fees", priority: "p0" },
      { key: "more", path: "/more", priority: "p1" },
      {
        key: "notifications",
        path: "/notifications",
        priority: "p1",
        readyText: "Fixture circular",
      },
    ],
  },
  {
    portal: "STUDENT",
    screens: [
      { key: "home", path: "/", priority: "p0" },
      { key: "notices", path: "/notices", priority: "p1", readyText: "Fixture circular" },
      { key: "attendance", path: "/attendance", priority: "p1" },
      { key: "subjects", path: "/subjects", priority: "p1" },
      { key: "tests", path: "/tests", priority: "p1" },
      { key: "papers", path: "/papers", priority: "p1" },
      { key: "path", path: "/path", priority: "p1" },
      { key: "timetable", path: "/timetable", priority: "p1" },
      { key: "fees", path: "/fees", priority: "p0" },
      { key: "profile", path: "/profile", priority: "p1" },
      { key: "more", path: "/more", priority: "p1" },
      {
        key: "notifications",
        path: "/notifications",
        priority: "p1",
        readyText: "Fixture circular",
      },
    ],
  },
];

