import { percent } from "./utils";

type StudentRow = {
  id: string;
  name: string;
  attendance: { status: string }[];
  examResults: { marks: number; exam: { maxMarks: number } }[];
  contestEntries: { rank: number | null }[];
};

export function classifyStudent(s: StudentRow) {
  const present = s.attendance.filter((a) => a.status !== "ABSENT").length;
  const attPct = s.attendance.length
    ? Math.round((present / s.attendance.length) * 100)
    : 100;
  const avg = s.examResults.length
    ? Math.round(
        s.examResults.reduce((n, r) => n + percent(r.marks, r.exam.maxMarks), 0) /
          s.examResults.length
      )
    : 0;
  const breakout = s.contestEntries.some((e) => e.rank && e.rank <= 3) || avg >= 85;
  const needs = attPct < 75 || (s.examResults.length > 0 && avg < 55);
  const band = breakout ? "breakout" : needs ? "support" : "steady";
  return { attPct, avg, band };
}
