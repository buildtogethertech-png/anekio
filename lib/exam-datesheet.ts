/**
 * Exam date sheet (printable / Save as PDF): for one exam of the year plan ("Unit Test 1"), one page per class
 * (1-A, 2-A, …) with what is written on which day — all classes, or just one.
 * Only dates, days, subjects and sitting times: no paper / copy due dates.
 */
import { can, type AccessUser } from "./permissions";
import { prisma } from "./prisma";
import { placeLines, schoolFromConfig } from "./school";

const TZ = "Asia/Kolkata";

function esc(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dayKey(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}
function dateText(d: Date) {
  return d.toLocaleDateString("en-IN", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
}
function weekday(d: Date) {
  return d.toLocaleDateString("en-IN", { timeZone: TZ, weekday: "long" });
}
function clock(hhmm: string) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
function timeText(start: string, end: string) {
  const a = clock(start), b = clock(end);
  return a && b ? `${a} – ${b}` : a || b;
}

type Paper = { day: string; date: Date; subject: string; time: string };
type ClassSheet = { id: string; label: string; papers: Paper[] };

/** The one sitting time every paper shares (shown once in the title), or "" when they differ. */
function commonTime(sheets: ClassSheet[]) {
  const times = new Set(sheets.flatMap((s) => s.papers.map((p) => p.time)));
  return times.size === 1 ? [...times][0] : "";
}
const timeLine = (t: string) => (t ? `<p class="time">Time: <strong>${esc(t)}</strong></p>` : "");

function classPage(input: { school: string; place: string; title: string; sheet: ClassSheet; common: string }) {
  const withTime = !input.common && input.sheet.papers.some((p) => p.time);
  const rows = input.sheet.papers
    .map(
      (p, i) =>
        `<tr><td class="n">${i + 1}</td><td><strong>${esc(dateText(p.date))}</strong></td><td>${esc(weekday(p.date))}</td><td class="subject">${esc(p.subject)}</td>${withTime ? `<td>${esc(p.time || "—")}</td>` : ""}</tr>`
    )
    .join("");
  return `<main class="sheet">
    <header><h1>${esc(input.school)}</h1>${input.place ? `<p class="place">${esc(input.place)}</p>` : ""}</header>
    <div class="title"><h2>${esc(input.title)}</h2><span class="pill">Class ${esc(input.sheet.label)}</span></div>
    ${timeLine(input.common)}
    <table class="list">
      <thead><tr><th class="n">#</th><th>Date</th><th>Day</th><th>Subject</th>${withTime ? "<th>Time</th>" : ""}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${withTime ? 5 : 4}" class="empty">No papers scheduled.</td></tr>`}</tbody>
    </table>
    <footer><span></span><span class="sign">Principal</span></footer>
  </main>`;
}

export function examDateSheetHtml(input: { school: string; place: string; title: string; sheets: ClassSheet[] }) {
  const common = commonTime(input.sheets);
  const pages = input.sheets.map((sheet) => classPage({ school: input.school, place: input.place, title: input.title, sheet, common }));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(input.title)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  html,body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { margin:0; background:#eef2f7; font-family:Inter,system-ui,"Segoe UI",sans-serif; color:#0f172a; }
  .toolbar { position:sticky; top:0; z-index:2; padding:12px; text-align:center; background:#eef2f7; }
  .toolbar button { font:600 14px Inter,system-ui,sans-serif; padding:9px 18px; border-radius:8px; border:0; background:#1F45C7; color:#fff; cursor:pointer; }
  .sheet { width:186mm; min-height:260mm; margin:16px auto 32px; background:#fff; padding:16mm 12mm 14mm; box-shadow:0 2px 18px #102a4322; box-sizing:border-box; display:flex; flex-direction:column; }
  header { text-align:center; border-bottom:2px solid #0f172a; padding-bottom:10px; }
  h1 { margin:0; font-size:22px; letter-spacing:.01em; }
  .place { margin:4px 0 0; color:#475569; font-size:12px; }
  .title { display:flex; align-items:center; justify-content:center; gap:10px; margin:16px 0 6px; }
  .time { margin:0 0 14px; text-align:center; font-size:12px; color:#334155; }
  h2 { margin:0; font-size:17px; font-weight:700; }
  .pill { font-size:12px; font-weight:700; padding:4px 10px; border-radius:999px; background:#EEF3FF; color:#1F45C7; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { border:1px solid #cbd5e1; padding:9px 10px; text-align:left; vertical-align:middle; }
  thead th { background:#0f172a; color:#fff; font-size:11px; letter-spacing:.05em; text-transform:uppercase; }
  .list td.n, .list th.n { width:28px; text-align:center; color:#64748b; }
  .list td.subject { font-weight:700; font-size:14px; }
  .list tbody tr:nth-child(even) td { background:#f8fafc; }
  td.empty { color:#94a3b8; text-align:center; }
  footer { margin-top:auto; padding-top:48px; display:flex; justify-content:space-between; font-size:12px; color:#334155; }
  .sign { border-top:1px solid #334155; padding-top:4px; min-width:150px; text-align:center; }
  @media print { body { background:#fff; } .toolbar { display:none; } .sheet { box-shadow:none; margin:0; width:auto; min-height:270mm; padding:0; } }
  .sheet + .sheet { page-break-before: always; break-before: page; }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">Save as PDF / Print</button></div>
  ${pages.join("\n")}
</body></html>`;
}

/** Office: date sheet for one exam (year plan item), all its classes or one class. */
export async function examDateSheetForUser(user: AccessUser, input: { planItemId?: string; sessionId?: string; classId?: string }) {
  if (!can(user, "exams.view") && !can(user, "exams.edit")) throw new Error("No access.");
  const planItemId = String(input.planItemId || "").trim();
  if (!planItemId) throw new Error("Pick an exam.");
  const classId = String(input.classId || "").trim();
  const sessionId = String(input.sessionId || "").trim();
  if (!sessionId) throw new Error("Pick the school year.");
  const series = await prisma.examSeries.findMany({
    where: { planItemId, sessionId, ...(classId ? { classId } : {}) },
    include: {
      class: { select: { id: true, name: true, section: true } },
      session: { select: { label: true } },
      exams: { select: { date: true, startTime: true, endTime: true, subject: { select: { name: true } } }, orderBy: [{ date: "asc" }, { startTime: "asc" }] },
    },
  });
  const scheduled = series.filter((s) => s.exams.length);
  if (!scheduled.length) throw new Error("No papers are scheduled for this exam yet.");
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const school = schoolFromConfig(config);
  const sheets: ClassSheet[] = scheduled
    .map((s) => ({
      id: s.class.id,
      label: `${s.class.name}-${s.class.section}`,
      papers: s.exams.map((e) => ({ day: dayKey(e.date), date: e.date, subject: e.subject.name, time: timeText(e.startTime, e.endTime) })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const sessionLabel = scheduled[0].session?.label || "";
  return examDateSheetHtml({
    school: school.name,
    place: placeLines(school).join(" · "),
    title: `${scheduled[0].name} · Date sheet${sessionLabel ? ` · ${sessionLabel}` : ""}`,
    sheets,
  });
}
