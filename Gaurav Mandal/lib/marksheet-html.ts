import type { AccessUser } from "./permissions";
import { prisma } from "./prisma";
import { attendancePct, gradePolicyFrom, marksVisible, studentSeriesScore } from "./exams";
import { schoolFromConfig } from "./school";
import { publicOrigin } from "./utils";

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function childForUser(user: AccessUser, requestedId?: string) {
  if (user.portal === "STUDENT") {
    const me = await prisma.student.findUnique({ where: { userId: user.id } });
    return me?.id || "";
  }
  if (user.portal === "PARENT") {
    const parent = await prisma.parent.findUnique({
      where: { userId: user.id },
      include: { students: { select: { id: true } } },
    });
    const ids = parent?.students.map((s) => s.id) || [];
    if (requestedId && ids.includes(requestedId)) return requestedId;
    return ids[0] || "";
  }
  if (user.portal === "OFFICE") return requestedId || "";
  return "";
}

function fileUrl(rel?: string) {
  if (!rel) return "";
  return `${publicOrigin()}/api/files/${rel}`;
}

export async function marksheetHtmlForUser(
  user: AccessUser,
  input: { seriesId?: string; examId?: string; studentId?: string }
) {
  const studentId = await childForUser(user, String(input.studentId || ""));
  if (!studentId) throw new Error("Student required");
  if (user.portal === "TEACHER") throw new Error("Open marksheets from office or the family login.");

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { class: true, parent: { include: { user: true } }, attendance: { take: 40 } },
  });
  if (!student) throw new Error("Student not found");

  const seriesId = String(input.seriesId || "");
  const examId = String(input.examId || "");
  const series = seriesId
    ? await prisma.examSeries.findFirst({
        where: { id: seriesId, classId: student.classId },
        include: { session: true, exams: { include: { subject: true, results: true }, orderBy: { date: "asc" } } },
      })
    : examId
      ? await prisma.examSeries.findFirst({
          where: { classId: student.classId, exams: { some: { id: examId } } },
          include: { session: true, exams: { include: { subject: true, results: true }, orderBy: { date: "asc" } } },
        })
      : null;
  if (!series) throw new Error("Published marksheet not found");

  const sittingReport = Boolean(seriesId) && !examId;
  if (sittingReport && series.exams.some((exam) => !marksVisible(exam))) {
    throw new Error("The report card is ready after every subject in this exam is published.");
  }

  const exams = series.exams.filter((exam) => {
    if (!marksVisible(exam)) return false;
    if (examId && exam.id !== examId) return false;
    return true;
  });
  if (!exams.length) throw new Error("This result is not published yet.");

  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const school = schoolFromConfig(config);
  const policy = gradePolicyFrom(config);
  const score = studentSeriesScore(
    student.id,
    exams.map((exam) => ({
      id: exam.id,
      title: exam.title,
      maxMarks: exam.maxMarks,
      date: exam.date,
      subject: exam.subject,
    })),
    exams.flatMap((exam) =>
      exam.results.map((row) => ({
        examId: exam.id,
        studentId: row.studentId,
        marks: row.marks,
        absent: row.absent,
        remarks: row.remarks,
      }))
    ),
    policy
  );
  const title = examId ? exams[0]?.title || series.name : series.name;
  const place = [school.address, [school.city, school.state, school.pincode].filter(Boolean).join(" ")].filter(Boolean);
  const att = attendancePct(student.attendance.map((row) => ({ status: row.status })));
  const logo = fileUrl(school.logoPath);
  const sign = fileUrl(school.signPath);
  const stamp = fileUrl(school.stampPath);
  const rows = score.rows
    .map(
      (row, index) => `<tr class="${index % 2 ? "alt" : ""}">
        <td>${esc(row.subject)}</td>
        <td class="num">${esc(row.missing ? "—" : row.absent ? "Ab" : row.marks)}</td>
        <td class="num">${esc(row.maxMarks)}</td>
        <td class="num">${esc(row.missing || row.absent ? "—" : `${row.pct}%`)}</td>
        <td>${esc(row.remarks || "—")}</td>
      </tr>`
    )
    .join("");
  const resultLine = !score.entered
    ? "Marks are pending"
    : score.passed
      ? "Pass"
      : "More support recommended";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>${esc(title)} · ${esc(student.name)}</title>
  <style>
    :root { --ink:#102a43; --muted:#5d6f86; --line:#d7e0ea; --navy:#16324f; --paper:#f4f7fb; }
    * { box-sizing: border-box; }
    body { margin:0; background:#e8eef5; color:var(--ink); font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif; }
    .toolbar { padding:14px; text-align:center; }
    .toolbar button { border:1px solid #c5d0dc; background:#fff; padding:8px 16px; border-radius:8px; font:600 13px/1.2 system-ui,sans-serif; cursor:pointer; }
    .sheet { width:210mm; max-width:100%; margin:0 auto 28px; background:#fff; padding:16mm 16mm 14mm; box-shadow:0 10px 40px rgba(16,42,67,.12); }
    .head { display:flex; gap:16px; align-items:center; border-bottom:3px solid var(--navy); padding-bottom:14px; }
    .logo { width:72px; height:72px; object-fit:contain; background:#fff; border:1px solid var(--line); border-radius:10px; padding:4px; }
    .mark { width:72px; height:72px; display:flex; align-items:center; justify-content:center; background:var(--navy); color:#fff; font:700 28px/1 system-ui,sans-serif; border-radius:10px; }
    h1 { font-size:22px; margin:0 0 4px; letter-spacing:.01em; }
    .place { color:var(--muted); font-size:12px; margin:0; font-family:system-ui,sans-serif; }
    .band { margin-top:14px; text-align:center; }
    .band span { display:inline-block; background:var(--navy); color:#fff; font:600 11px/1 system-ui,sans-serif; letter-spacing:.12em; text-transform:uppercase; padding:7px 14px; border-radius:999px; }
    .band h2 { margin:10px 0 0; font-size:26px; }
    .meta { display:grid; grid-template-columns:1fr 1fr; border:1px solid var(--line); border-radius:10px; overflow:hidden; margin-top:18px; font-family:system-ui,sans-serif; }
    .meta div { padding:10px 12px; border-bottom:1px solid var(--line); }
    .meta div:nth-child(odd) { border-right:1px solid var(--line); }
    .meta b { display:block; font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); font-weight:600; }
    .meta span { font-size:14px; font-weight:600; }
    table { width:100%; border-collapse:collapse; margin-top:18px; font-family:system-ui,sans-serif; font-size:13px; }
    th { background:var(--navy); color:#fff; text-align:left; padding:9px 10px; font-size:11px; letter-spacing:.08em; text-transform:uppercase; }
    td { padding:9px 10px; border-bottom:1px solid var(--line); }
    tr.alt td { background:var(--paper); }
    td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; }
    .totals { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:16px; font-family:system-ui,sans-serif; }
    .box { background:var(--paper); border-radius:10px; padding:12px; }
    .box b { display:block; font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
    .box span { display:block; margin-top:4px; font-size:18px; font-weight:700; }
    .verdict { margin-top:14px; text-align:center; padding:12px; border-radius:10px; font-family:system-ui,sans-serif; font-weight:700; }
    .pass { background:#ecfdf3; color:#166534; }
    .fail { background:#fff7ed; color:#9a3412; }
    .pending { background:var(--paper); color:var(--muted); }
    .signs { display:flex; justify-content:space-between; align-items:flex-end; margin-top:36px; font-family:system-ui,sans-serif; font-size:12px; color:var(--muted); }
    .signs .col { width:42%; text-align:center; }
    .signs img.sign { max-height:42px; max-width:100%; display:block; margin:0 auto 6px; }
    .signs img.stamp { max-height:56px; float:left; margin-right:8px; }
    .line { border-top:1px solid #9aa8b8; padding-top:6px; }
    @media print {
      body { background:#fff; }
      .toolbar { display:none; }
      .sheet { box-shadow:none; margin:0; width:auto; }
    }
  </style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Save as PDF</button></div>
  <main class="sheet">
    <header class="head">
      ${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : `<div class="mark">${esc((school.name || "S").slice(0, 1))}</div>`}
      <div>
        <h1>${esc(school.name || "School")}</h1>
        <p class="place">${esc(place.join(" · "))}${school.affiliation ? ` · ${esc(school.affiliation)}` : ""}${school.phone ? ` · ${esc(school.phone)}` : ""}</p>
      </div>
    </header>
    <div class="band">
      <span>${esc(series.session.label)} · Class ${esc(`${student.class.name}-${student.class.section}`)}</span>
      <h2>${esc(title)}</h2>
    </div>
    <section class="meta">
      <div><b>Student</b><span>${esc(student.name)}</span></div>
      <div><b>Admission no.</b><span>${esc(student.admissionNo)}</span></div>
      <div><b>Parent</b><span>${esc(student.parent?.user.name || "—")}</span></div>
      <div><b>Sitting</b><span>${esc(series.name)}</span></div>
    </section>
    <table>
      <thead><tr><th>Subject</th><th class="num">Marks</th><th class="num">Max</th><th class="num">%</th><th>Remark</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="box"><b>Total</b><span>${esc(score.entered ? `${score.total} / ${score.max}` : "—")}</span></div>
      <div class="box"><b>Percentage</b><span>${esc(score.entered ? `${score.pct}%` : "—")}</span></div>
      <div class="box"><b>Grade</b><span>${esc(score.grade || "—")}</span></div>
      <div class="box"><b>Attendance</b><span>${esc(att == null ? "—" : `${att}%`)}</span></div>
    </div>
    <div class="verdict ${score.entered ? (score.passed ? "pass" : "fail") : "pending"}">${esc(resultLine)}</div>
    <footer class="signs">
      <div class="col"><div class="line">Class teacher</div></div>
      <div class="col">
        ${stamp ? `<img class="stamp" src="${esc(stamp)}" alt="">` : ""}
        ${sign ? `<img class="sign" src="${esc(sign)}" alt="">` : ""}
        <div class="line">${esc(school.signatory || "Principal")}</div>
      </div>
    </footer>
  </main>
</body>
</html>`;
}
