import { attendancePct, gradeForPercent, type GradePolicy } from "./exams";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export function academicYearLabel(sessionStart?: string, sessionEnd?: string) {
  const start = Number(String(sessionStart || "").slice(0, 4));
  const end = Number(String(sessionEnd || "").slice(0, 4));
  if (start && end) return `${start}–${String(end).slice(2)}`;
  if (start) return `${start}–${String(start + 1).slice(2)}`;
  return "2026–27";
}

export function splitClassLabel(classLabel?: string) {
  const raw = String(classLabel || "").trim();
  const match = raw.match(/^(.*?)[\s-]+([A-Za-z0-9]+)$/);
  if (match) return { className: match[1].trim(), sectionName: match[2].trim() };
  return { className: raw || "—", sectionName: "—" };
}

export function nextClassName(className?: string) {
  const raw = String(className || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const roman = ROMAN.indexOf(raw);
  if (roman >= 0 && roman < ROMAN.length - 1) return ROMAN[roman + 1];
  const num = Number.parseInt(raw, 10);
  if (num >= 1 && num < 12) return String(num + 1);
  return "";
}

export function gradePointFor(grade: string, pct: number) {
  const key = String(grade || "").toUpperCase();
  const mapped: Record<string, string> = {
    A1: "10.0",
    "A+": "9.0",
    A: "8.5",
    A2: "9.0",
    B1: "8.0",
    "B+": "7.5",
    B: "7.0",
    B2: "7.0",
    C1: "6.0",
    C: "6.0",
    C2: "5.0",
    D: "4.0",
    E: "0.0",
    F: "0.0",
  };
  if (mapped[key]) return mapped[key];
  return Math.max(0, Math.min(10, Math.round((Number(pct) || 0) / 10))).toFixed(1);
}

export function remarkForPercent(pct: number) {
  if (pct >= 90) return "Excellent";
  if (pct >= 80) return "Very Good";
  if (pct >= 70) return "Good";
  if (pct >= 60) return "Satisfactory";
  return "Needs improvement";
}

export function promotionStatusFor(passed: boolean, entered: boolean) {
  if (!entered) return "PENDING";
  if (passed) return "PROMOTED";
  return "NEEDS IMPROVEMENT";
}

export const DEFAULT_CO_SCHOLASTIC = [
  { Activity: "Sports", Grade: "A", Remark: "Excellent participation" },
  { Activity: "Discipline", Grade: "A+", Remark: "Outstanding" },
  { Activity: "Art & Craft", Grade: "A", Remark: "Very Good" },
  { Activity: "Communication", Grade: "A", Remark: "Good" },
];

export type ReportMarkRow = {
  subject: string;
  marks: number | string;
  maxMarks: number;
  absent?: boolean;
  remarks?: string;
  pct?: number;
  grade?: string;
};

export function buildReportCardResults(input: {
  rows: ReportMarkRow[];
  policy?: Pick<GradePolicy, "bands" | "passPercent">;
  attendance?: { status: string }[];
  classRank?: number | string;
  className?: string;
  teacherRemark?: string;
}) {
  const bands = input.policy?.bands || [
    { min: 91, grade: "A+" },
    { min: 81, grade: "A" },
    { min: 71, grade: "B+" },
    { min: 61, grade: "B" },
    { min: 51, grade: "C" },
    { min: 0, grade: "D" },
  ];
  const passPercent = input.policy?.passPercent ?? 33;
  let total = 0;
  let max = 0;
  let entered = 0;
  const marks = input.rows.map((row) => {
    const absent = Boolean(row.absent) || String(row.marks).toLowerCase() === "absent";
    const numeric = absent || row.marks === "—" || row.marks === "" || row.marks == null ? null : Number(row.marks);
    const usable = numeric != null && Number.isFinite(numeric);
    if (usable || absent) {
      entered += 1;
      max += Number(row.maxMarks) || 0;
      total += usable ? numeric : 0;
    }
    const pct = usable && row.maxMarks ? Math.round((numeric / row.maxMarks) * 1000) / 10 : Number(row.pct) || 0;
    const grade = row.grade || (usable ? gradeForPercent(pct, bands) : "—");
    return {
      Subject: row.subject,
      "Max Marks": row.maxMarks,
      "Marks Obtained": absent ? "Ab" : usable ? numeric : "—",
      Grade: grade,
      "Grade Point": usable ? gradePointFor(String(grade), pct) : "—",
      Remark: row.remarks || (usable ? remarkForPercent(pct) : "—"),
    };
  });
  const percentage = max ? Math.round((total / max) * 1000) / 10 : 0;
  const overallGrade = max ? gradeForPercent(percentage, bands) : "—";
  const passed = max ? percentage >= passPercent : false;
  const attRows = input.attendance || [];
  const workingDays = attRows.length;
  const daysAbsent = attRows.filter((row) => row.status === "ABSENT").length;
  const daysPresent = workingDays - daysAbsent;
  const attendancePercentage = workingDays ? attendancePct(attRows) ?? 0 : 0;
  const promotionStatus = promotionStatusFor(passed, entered > 0);
  const nextClass = promotionStatus === "PROMOTED" ? nextClassName(input.className) : "";
  const nextLine = promotionStatus === "PROMOTED"
    ? `Promoted to Class ${nextClass || "the next class"}`
    : promotionStatus === "NEEDS IMPROVEMENT"
      ? "Continue in the same class with additional support"
      : "Result will be confirmed after marks are published";
  return {
    marks,
    activities: DEFAULT_CO_SCHOLASTIC,
    totalMarks: max || "",
    marksObtained: entered ? total : "",
    percentage: entered ? percentage : "",
    overallGrade: entered ? overallGrade : "—",
    classRank: input.classRank ?? "",
    workingDays: workingDays || "",
    daysPresent: workingDays ? daysPresent : "",
    daysAbsent: workingDays ? daysAbsent : "",
    attendancePercentage: workingDays ? attendancePercentage : "",
    attendanceBar: workingDays ? attendancePercentage : "",
    teacherRemark:
      input.teacherRemark ||
      "Excellent academic performance. Continue the same level of dedication and participation.",
    promotionStatus,
    nextClass: nextLine,
    sessionTitle: "",
  };
}

export function sampleReportCardPreviewData() {
  const results = buildReportCardResults({
    rows: [
      { subject: "Mathematics", marks: 87, maxMarks: 100 },
      { subject: "English", marks: 82, maxMarks: 100 },
      { subject: "Science", marks: 91, maxMarks: 100 },
      { subject: "Social Science", marks: 78, maxMarks: 100 },
      { subject: "Hindi", marks: 85, maxMarks: 100 },
    ],
    className: "VIII",
    classRank: 6,
    teacherRemark:
      "Excellent performance. Keep working consistently and participate more actively in classroom activities.",
    attendance: Array.from({ length: 100 }, (_, index) => ({ status: index < 92 ? "PRESENT" : "ABSENT" })),
  });
  return {
    school: {
      name: "Springfield Public School",
      address: "12, Lake Road, Bengaluru, Karnataka 560001",
      phone: "080 4000 1200",
      email: "office@springfield.school",
      contact: "080 4000 1200 • office@springfield.school",
      academicYear: "2026–27",
      sessionTitle: "Academic Session 2026–27",
      website: "www.springfield.school",
      signatory: "Principal",
    },
    student: {
      name: "Aarav Sharma",
      admissionNo: "ADM-2026-0142",
      classLabel: "VIII-A",
      className: "VIII",
      sectionName: "A",
      rollNo: "17",
      id: "STU-0142",
      dateOfBirth: "12 Apr 2013",
      born: "12 Apr 2013",
      gender: "Boy",
      parent: "Meera Sharma",
      parentPhone: "9800000042",
    },
    staff: {
      classTeacherName: "Kavita Joshi",
      principalName: "Principal",
    },
    results,
    exam: { name: "Annual Examination" },
    document: {},
  };
}

export function mergeReportCardData(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const school = {
    ...((base.school && typeof base.school === "object" ? base.school : {}) as Record<string, unknown>),
    ...((overlay.school && typeof overlay.school === "object" ? overlay.school : {}) as Record<string, unknown>),
  };
  const student = {
    ...((base.student && typeof base.student === "object" ? base.student : {}) as Record<string, unknown>),
    ...((overlay.student && typeof overlay.student === "object" ? overlay.student : {}) as Record<string, unknown>),
  };
  const results = {
    ...((base.results && typeof base.results === "object" ? base.results : {}) as Record<string, unknown>),
    ...((overlay.results && typeof overlay.results === "object" ? overlay.results : {}) as Record<string, unknown>),
  };
  const staff = {
    ...((base.staff && typeof base.staff === "object" ? base.staff : {}) as Record<string, unknown>),
    ...((overlay.staff && typeof overlay.staff === "object" ? overlay.staff : {}) as Record<string, unknown>),
  };
  return { ...base, ...overlay, school, student, results, staff };
}
