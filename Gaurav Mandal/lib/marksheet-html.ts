import type { AccessUser } from "./permissions";
import { prisma } from "./prisma";
import { attendancePct, gradePolicyFrom, marksVisible, studentSeriesScore } from "./exams";
import { paidFeeMonthCount, reportCardFeeMonthsRequired, reportCardUnlocked } from "./fees";
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
  if (sittingReport && (user.portal === "PARENT" || user.portal === "STUDENT")) {
    const invoices = await prisma.feeInvoice.findMany({
      where: { studentId },
      include: { payments: true },
    });
    const configForFees = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
    const required = reportCardFeeMonthsRequired(configForFees);
    const paidMonths = paidFeeMonthCount(invoices);
    if (!reportCardUnlocked(paidMonths, required)) {
      throw new Error(
        required === 1
          ? "This report card is released after one fee month is paid."
          : `This report card is released after ${required} fee months are paid.`
      );
    }
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
  const attPresent = student.attendance.filter((row) => row.status !== "ABSENT").length;
  const attTotal = student.attendance.length;
  const attColor = att == null ? "#64748B" : att >= 90 ? "#16A34A" : att >= 75 ? "#2563EB" : att >= 60 ? "#F59E0B" : "#DC2626";
  const resultLine = !score.entered
    ? "PENDING"
    : score.passed
      ? "PROMOTED"
      : "NEEDS IMPROVEMENT";
  const resultHint = !score.entered
    ? "Result will be confirmed after marks are published"
    : score.passed
      ? `Promoted on the basis of ${esc(series.session.label)}`
      : "Continue in the same class with additional support";
  const year = series.session.label || "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Student Report Card · ${esc(student.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root { --blue:#2563EB; --purple:#7C3AED; --cyan:#06B6D4; --ink:#0F172A; --muted:#64748B; --line:#E2E8F0; --paper:#F8FAFC; }
    * { box-sizing: border-box; }
    body { margin:0; background:#eef2f7; color:var(--ink); font-family: Inter, system-ui, sans-serif; }
    .toolbar { padding:14px; text-align:center; }
    .toolbar button { border:1px solid #c5d0dc; background:#fff; padding:8px 16px; border-radius:8px; font:600 13px/1.2 Inter,system-ui,sans-serif; cursor:pointer; }
    .sheet { width:210mm; min-height:297mm; max-width:100%; margin:0 auto 28px; background:#fff; overflow:hidden; box-shadow:0 10px 40px rgba(15,23,42,.08); }
    .head { display:flex; align-items:center; gap:16px; padding:18px 22px; background:linear-gradient(90deg,#2563EB 0%,#4F46E5 55%,#7C3AED 100%); color:#fff; }
    .logo { width:64px; height:64px; object-fit:contain; background:#fff; border-radius:999px; padding:6px; }
    .mark { width:64px; height:64px; display:flex; align-items:center; justify-content:center; background:#fff; color:#2563EB; font:800 24px/1 Inter,sans-serif; border-radius:999px; }
    .head h1 { font-size:22px; margin:0 0 4px; font-weight:800; }
    .place { margin:0; font-size:10px; color:#DBEAFE; }
    .year { margin-left:auto; text-align:right; }
    .year b { display:block; font-size:8px; letter-spacing:.12em; color:#DDD6FE; }
    .year span { font-size:13px; font-weight:800; }
    .cyan { height:4px; background:#06B6D4; }
    .title { text-align:center; padding:16px 22px 8px; }
    .title h2 { margin:0; font-size:18px; letter-spacing:.08em; }
    .pill { display:inline-block; margin-top:8px; background:#EDE9FE; color:#7C3AED; font:700 10px/1 Inter,sans-serif; padding:6px 12px; border-radius:999px; }
    .profile { margin:10px 22px; display:flex; gap:16px; padding:14px; background:#EEF2FF; border:1px solid #DBEAFE; border-radius:12px; }
    .photo { width:70px; height:85px; object-fit:cover; border-radius:10px; background:#fff; border:1px solid #93C5FD; }
    .photo-ph { width:70px; height:85px; border-radius:10px; border:1px dashed #93C5FD; background:#fff; display:flex; align-items:center; justify-content:center; color:#64748B; font-size:10px; }
    .meta { display:grid; grid-template-columns:repeat(4,1fr); gap:10px 16px; flex:1; }
    .meta b { display:block; font-size:8px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
    .meta span { font-size:12px; font-weight:700; }
    .status { display:inline-block; margin-top:4px; background:#DCFCE7; color:#16A34A; font:800 9px/1 Inter,sans-serif; padding:5px 10px; border-radius:999px; }
    .section { margin:8px 22px 0; }
    .section h3 { margin:0; background:var(--blue); color:#fff; font-size:11px; letter-spacing:.1em; padding:8px 12px; border-radius:8px 8px 0 0; }
    table { width:100%; border-collapse:collapse; font-size:11px; }
    th { background:#2563EB; color:#fff; text-align:left; padding:8px 10px; font-size:9px; letter-spacing:.08em; text-transform:uppercase; }
    td { padding:7px 10px; border-bottom:1px solid var(--line); }
    tr.alt td { background:var(--paper); }
    td.num, th.num { text-align:center; }
    .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-weight:800; font-size:10px; background:#DBEAFE; color:#2563EB; }
    .cards { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin:12px 22px 0; }
    .box { background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
    .box b { display:block; font-size:8px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
    .box span { display:block; margin-top:4px; font-size:18px; font-weight:800; color:var(--blue); }
    .box.grade { background:#2563EB; border-color:#2563EB; }
    .box.grade b, .box.grade span { color:#fff; }
    .split { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:12px 22px 0; }
    .panel h3 { background:#7C3AED; }
    .panel.blue h3 { background:#2563EB; }
    .panel-body { border:1px solid var(--line); border-top:none; border-radius:0 0 8px 8px; padding:10px 12px; background:var(--paper); }
    .att-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; font-size:11px; }
    .bar { margin-top:10px; display:flex; align-items:center; gap:8px; }
    .bar .track { flex:1; height:8px; background:#E2E8F0; border-radius:999px; overflow:hidden; }
    .bar .fill { height:100%; background:${attColor}; }
    .remark { margin:12px 22px 0; }
    .remark h3 { background:#E0E7FF; color:#3730A3; }
    .remark p { margin:0; padding:12px; border:1px solid var(--line); border-top:none; border-radius:0 0 8px 8px; min-height:52px; font-size:12px; color:#334155; background:var(--paper); }
    .verdict { margin:12px 22px 0; text-align:center; padding:14px; border-radius:12px; background:#ECFDF3; border:1px solid #BBF7D0; }
    .verdict.fail { background:#FFFBEB; border-color:#FDE68A; }
    .verdict.pending { background:var(--paper); border-color:var(--line); }
    .verdict b { display:block; font-size:8px; letter-spacing:.12em; color:#166534; }
    .verdict strong { display:block; margin:6px 0 4px; font-size:20px; color:#15803D; }
    .verdict.fail b, .verdict.fail strong { color:#B45309; }
    .signs { display:flex; justify-content:space-between; gap:16px; margin:28px 22px 10px; font-size:11px; color:var(--muted); }
    .signs .col { flex:1; text-align:center; }
    .signs img.sign { max-height:40px; max-width:100%; display:block; margin:0 auto 6px; }
    .line { border-top:1px solid #94A3B8; padding-top:6px; font-weight:700; color:var(--ink); }
    .foot { display:flex; justify-content:space-between; margin:8px 22px 16px; font-size:8px; color:#94A3B8; }
    @media print { body { background:#fff; } .toolbar { display:none; } .sheet { box-shadow:none; margin:0; width:auto; } }
  </style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Save as PDF</button></div>
  <main class="sheet">
    <header class="head">
      ${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : `<div class="mark">${esc((school.name || "S").slice(0, 1))}</div>`}
      <div>
        <h1>${esc(school.name || "School")}</h1>
        <p class="place">${esc(place.join(" · "))}${school.phone ? ` · ${esc(school.phone)}` : ""}${school.email ? ` · ${esc(school.email)}` : ""}</p>
      </div>
      <div class="year"><b>ACADEMIC SESSION</b><span>${esc(year)}</span></div>
    </header>
    <div class="cyan"></div>
    <div class="title">
      <h2>STUDENT REPORT CARD</h2>
      <div class="pill">${esc(year)} · ${esc(title)}</div>
    </div>
    <section class="profile">
      <div class="photo-ph">Photo</div>
      <div class="meta">
        <div><b>Student name</b><span>${esc(student.name)}</span><div class="status">${esc(resultLine)}</div></div>
        <div><b>Admission no</b><span>${esc(student.admissionNo)}</span></div>
        <div><b>Class</b><span>${esc(`${student.class.name}-${student.class.section}`)}</span></div>
        <div><b>Parent</b><span>${esc(student.parent?.user.name || "—")}</span></div>
      </div>
    </section>
    <section class="section">
      <h3>ACADEMIC PERFORMANCE</h3>
      <table>
        <thead><tr><th>Subject</th><th class="num">Max</th><th class="num">Marks</th><th class="num">%</th><th>Remark</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
    <div class="cards">
      <div class="box"><b>Total</b><span>${esc(score.entered ? `${score.total} / ${score.max}` : "—")}</span></div>
      <div class="box"><b>Percentage</b><span>${esc(score.entered ? `${score.pct}%` : "—")}</span></div>
      <div class="box grade"><b>Grade</b><span>${esc(score.grade || "—")}</span></div>
      <div class="box"><b>Attendance</b><span>${esc(att == null ? "—" : `${att}%`)}</span></div>
    </div>
    <div class="split">
      <div class="panel">
        <h3>ATTENDANCE</h3>
        <div class="panel-body">
          <div class="att-grid">
            <div><b>Working</b><div>${esc(attTotal || "—")}</div></div>
            <div><b>Present</b><div>${esc(attTotal ? attPresent : "—")}</div></div>
            <div><b>Absent</b><div>${esc(attTotal ? attTotal - attPresent : "—")}</div></div>
            <div><b>Percent</b><div>${esc(att == null ? "—" : `${att}%`)}</div></div>
          </div>
          ${att == null ? "" : `<div class="bar"><div class="track"><div class="fill" style="width:${att}%"></div></div><strong style="color:${attColor}">${att}%</strong></div>`}
        </div>
      </div>
      <div class="panel blue">
        <h3>CO-SCHOLASTIC & ACTIVITIES</h3>
        <div class="panel-body">
          <table>
            <thead><tr><th>Activity</th><th>Grade</th><th>Remark</th></tr></thead>
            <tbody>
              <tr><td>Sports</td><td><span class="badge">A</span></td><td>Excellent participation</td></tr>
              <tr class="alt"><td>Discipline</td><td><span class="badge">A+</span></td><td>Outstanding</td></tr>
              <tr><td>Art & Craft</td><td><span class="badge">A</span></td><td>Very Good</td></tr>
              <tr class="alt"><td>Communication</td><td><span class="badge">A</span></td><td>Good</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="remark">
      <h3>TEACHER'S REMARKS</h3>
      <p>${esc(score.rows.map((row) => row.remarks).filter(Boolean).join(" ") || "Excellent academic performance. Continue the same level of dedication and participation.")}</p>
    </div>
    <div class="verdict ${score.entered ? (score.passed ? "" : "fail") : "pending"}">
      <b>FINAL RESULT</b>
      <strong>${esc(resultLine)}</strong>
      <span>${esc(resultHint)}</span>
    </div>
    <footer class="signs">
      <div class="col"><div class="line">Class Teacher</div></div>
      <div class="col">
        ${stamp ? `<img class="stamp" src="${esc(stamp)}" alt="">` : ""}
        ${sign ? `<img class="sign" src="${esc(sign)}" alt="">` : ""}
        <div class="line">${esc(school.signatory || "Principal")}</div>
      </div>
      <div class="col"><div class="line">Parent / Guardian</div></div>
    </footer>
    <div class="foot"><span>Generated by Anekio</span><span>${esc(school.email || "")}</span></div>
  </main>
</body>
</html>`;
}
