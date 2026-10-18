const pptxgen = require("pptxgenjs");
const fs = require("fs");
const { applyTheme } = require("/root/.claude/skills/synced/0a12ddb9-f4a4-4062-9f88-c58ce4edfdfa_2c8150ce-0f05-4d97-ac4e-e15b5a041e8c/pptx/scripts/apply_theme.js");

const THEME = {
  name: "Anekio",
  headFontFace: "Arial",
  bodyFontFace: "Calibri",
  colors: { dk1: "0B1530", lt1: "FFFFFF", dk2: "334761", lt2: "F3F6FC", accent1: "2855F6", accent2: "22C1F0", accent3: "14B889", accent4: "F5B93F", accent5: "FF5D7A", accent6: "8DFFD2", hlink: "2855F6", folHlink: "22C1F0" },
};
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.author = "Anekio";
pres.title = "Anekio — School ERP for Indian schools";
const C = pres.SchemeColor;
const W = 13.333, H = 7.5;
const img = (n) => `framed/${n}.png`;

// Layouts
pres.defineSlideMaster({ title: "DARK", background: { path: "assets/bg-dark.jpg" }, objects: [
  { image: { x: 0.5, y: 6.85, w: 0.32, h: 0.32, path: "assets/mark.png" } },
  { text: { text: "anekio.com", options: { x: 0.9, y: 6.85, w: 3, h: 0.32, fontSize: 11, color: C.background1, margin: 0, valign: "middle" } } },
], slideNumber: { x: 12.4, y: 6.9, w: 0.6, h: 0.3, fontSize: 10, color: C.background1, align: "right" } });
pres.defineSlideMaster({ title: "LIGHT", background: { path: "assets/bg-light.jpg" }, objects: [
  { image: { x: 0.5, y: 6.85, w: 0.32, h: 0.32, path: "assets/mark.png" } },
  { text: { text: "anekio.com", options: { x: 0.9, y: 6.85, w: 3, h: 0.32, fontSize: 11, color: C.text2, margin: 0, valign: "middle" } } },
  { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.45, w: 12.1, h: 0.9, fontSize: 34, bold: true, color: C.text1, margin: 0, valign: "middle", align: "left" } } },
  { placeholder: { options: { name: "kicker", type: "body", x: 0.6, y: 0.2, w: 8, h: 0.3, fontSize: 11, bold: true, color: C.accent1, margin: 0, charSpacing: 3 } } },
], slideNumber: { x: 12.4, y: 6.9, w: 0.6, h: 0.3, fontSize: 10, color: C.text2, align: "right" } });

function check(slide, x, y, text, dark = false, w = 5.6) {
  slide.addShape(pres.ShapeType.ellipse, { x, y: y + 0.04, w: 0.26, h: 0.26, fill: { color: dark ? C.accent6 : C.accent3 } });
  slide.addText("✓", { x: x - 0.005, y: y + 0.03, w: 0.27, h: 0.28, fontSize: 11, bold: true, color: dark ? "0B1530" : "FFFFFF", align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: "check mark" });
  slide.addText(text, { x: x + 0.38, y, w, h: 0.34, fontSize: 15, color: dark ? C.background1 : C.text1, margin: 0, valign: "middle", isTextBox: true, objectName: "point" });
}
function kickerTitle(slide, kicker, title) {
  slide.addText(kicker.toUpperCase(), { placeholder: "kicker" });
  slide.addText(title, { placeholder: "title" });
}

// 1. Title
pres.addSection({ title: "Open" });
let s = pres.addSlide({ masterName: "DARK", sectionTitle: "Open" });
s.addImage({ path: "assets/mark.png", x: 0.7, y: 0.7, w: 0.7, h: 0.7 });
s.addText("Anekio", { x: 1.55, y: 0.7, w: 4, h: 0.7, fontSize: 30, bold: true, color: C.background1, margin: 0, valign: "middle", isTextBox: true, objectName: "brand" });
s.addText([{ text: "Run your whole\nschool from ", options: {} }, { text: "one record.", options: { color: C.accent6 } }], { x: 0.7, y: 2.0, w: 6.4, h: 2.2, fontSize: 40, bold: true, color: C.background1, margin: 0, valign: "top", isTextBox: true, objectName: "headline", lineSpacingMultiple: 1.05 });
s.addText("Admissions, fees, attendance, exams, routine, notices and the parent app — connected on the web and on Android.", { x: 0.7, y: 4.3, w: 6.2, h: 1.1, fontSize: 17, color: "B9C6E4", margin: 0, isTextBox: true, objectName: "sub" });
s.addText("School ERP for growing Indian schools", { x: 0.7, y: 5.6, w: 6, h: 0.4, fontSize: 13, color: C.accent2, bold: true, margin: 0, isTextBox: true, objectName: "tag" });
s.addImage({ path: img("office-dashboard"), x: 7.0, y: 1.2, w: 6.1, h: 6.1 * (1228 / 1762) });
s.addImage({ path: img("01-parent-home"), x: 11.0, y: 2.6, w: 1.9, h: 1.9 * (1728 / 884) });
s.addNotes("Anekio is a school ERP built for Indian schools: one student record shared by the office, teachers and parents, on web and Android.");

// 2. Today's problem
pres.addSection({ title: "Why" });
s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Why" });
kickerTitle(s, "The problem", "Registers, Excel and WhatsApp groups don't scale");
const pains = [
  ["Fees in a notebook", "Who paid, who's overdue and how much is a half-day reconciliation."],
  ["Attendance on paper", "The office learns about absences at month end."],
  ["Results by photo", "Marks typed twice; report cards made in Word."],
  ["Parents call the office", "The same five questions, every day, to whoever picks up."],
];
pains.forEach((p, i) => {
  const x = 0.6 + (i % 2) * 6.2, y = 1.75 + Math.floor(i / 2) * 2.35;
  s.addShape(pres.ShapeType.roundRect, { x, y, w: 5.9, h: 2.0, fill: { color: C.background1 }, line: { color: "E3E9F3", width: 1 }, rectRadius: 0.18, shadow: { type: "outer", blur: 12, offset: 3, angle: 90, color: "0B1530", opacity: 0.08 } });
  s.addShape(pres.ShapeType.ellipse, { x: x + 0.3, y: y + 0.32, w: 0.5, h: 0.5, fill: { color: "FDE8E8" } });
  s.addText("✕", { x: x + 0.3, y: y + 0.32, w: 0.5, h: 0.5, fontSize: 16, bold: true, color: "B42318", align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: `pain icon ${i + 1}` });
  s.addText(p[0], { x: x + 1.0, y: y + 0.3, w: 4.6, h: 0.5, fontSize: 20, bold: true, color: C.text1, margin: 0, valign: "middle", isTextBox: true, objectName: `pain title ${i + 1}` });
  s.addText(p[1], { x: x + 1.0, y: y + 0.9, w: 4.6, h: 0.9, fontSize: 15, color: C.text2, margin: 0, isTextBox: true, objectName: `pain body ${i + 1}` });
});
s.addNotes("Most schools we meet run on registers, Excel and WhatsApp. Each works alone; none of them talk to each other.");

// 3. One record
s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Why" });
kickerTitle(s, "One platform", "Capture once. Use everywhere.");
const steps = [["1", "Admit the student", "The admission form becomes the working student file: class, parent, documents, billing month."], ["2", "Every team works on it", "Fees, attendance, exams, routine and notices read and write the same record."], ["3", "Each role sees what it needs", "Office gets control, teachers get their classes, parents get their child."]];
steps.forEach((st, i) => {
  const x = 0.6 + i * 4.15;
  s.addShape(pres.ShapeType.roundRect, { x, y: 1.9, w: 3.9, h: 3.1, fill: { color: C.background1 }, line: { color: "E3E9F3", width: 1 }, rectRadius: 0.2, shadow: { type: "outer", blur: 14, offset: 4, angle: 90, color: "0B1530", opacity: 0.08 } });
  s.addShape(pres.ShapeType.roundRect, { x: x + 0.35, y: 2.25, w: 0.7, h: 0.7, fill: { color: C.accent1 }, line: { color: C.accent1 }, rectRadius: 0.18 });
  s.addText(st[0], { x: x + 0.35, y: 2.25, w: 0.7, h: 0.7, fontSize: 22, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: `step ${st[0]}` });
  s.addText(st[1], { x: x + 0.35, y: 3.15, w: 3.3, h: 0.5, fontSize: 19, bold: true, color: C.text1, margin: 0, isTextBox: true, objectName: `step title ${st[0]}` });
  s.addText(st[2], { x: x + 0.35, y: 3.7, w: 3.3, h: 1.2, fontSize: 14, color: C.text2, margin: 0, isTextBox: true, objectName: `step body ${st[0]}` });
  if (i < 2) s.addText("→", { x: x + 3.9, y: 3.1, w: 0.3, h: 0.5, fontSize: 22, color: C.accent1, align: "center", margin: 0, isTextBox: true, objectName: `arrow ${i + 1}` });
});
s.addText("Web portal for the office · Android app for teachers and parents · the same data in both.", { x: 0.6, y: 5.5, w: 12, h: 0.5, fontSize: 15, italic: true, color: C.accent1, margin: 0, isTextBox: true, objectName: "footnote" });
s.addNotes("The core idea: one student record. Everything else hangs off it.");

// 4. Office
pres.addSection({ title: "Product" });
s = pres.addSlide({ masterName: "DARK", sectionTitle: "Product" });
s.addText("FOR THE OFFICE", { x: 0.6, y: 0.4, w: 6, h: 0.3, fontSize: 11, bold: true, color: C.accent6, margin: 0, charSpacing: 3, isTextBox: true, objectName: "kicker" });
s.addText("See the whole day before it starts", { x: 0.6, y: 0.75, w: 6.2, h: 1.2, fontSize: 32, bold: true, color: C.background1, margin: 0, isTextBox: true, objectName: "title" });
["Timetable gaps, absent teachers and overdue fees on one desk", "Fees register with UPI, cash, pay-link and bank collection", "Attendance overview across every class by 10 AM", "Notices to parents, teachers or students with a preview", "Roles & permissions, decided area by area"].forEach((t, i) => check(s, 0.6, 2.3 + i * 0.55, t, true));
s.addImage({ path: img("office-dashboard"), x: 6.9, y: 0.6, w: 6.2, h: 6.2 * (1228 / 1762) });
s.addImage({ path: img("08-office-fees-register"), x: 10.9, y: 2.9, w: 1.95, h: 1.95 * (1728 / 884) });
s.addNotes("The admin desk: what needs attention today, collection trend, fee health. The office app mirrors it on the phone.");

// 5. Teachers
s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Product" });
kickerTitle(s, "For teachers", "Lose the paperwork, not the control");
["Mark a whole class present in under a minute (P / L / A)", "Own timetable with recess and rooms", "Question-paper handover and marks entry with deadlines", "Apply for leave; balance and approver shown", "Teacher QR for the school's attendance scanner"].forEach((t, i) => check(s, 0.6, 1.8 + i * 0.6, t));
[["05-teacher-attendance", 7.0], ["06-teacher-timetable", 9.1], ["04-teacher-apply-leave", 11.2]].forEach(([n, x], i) => s.addImage({ path: img(n), x, y: 1.75 + (i === 1 ? -0.25 : 0.2), w: 1.95, h: 1.95 * (1728 / 884) }));
s.addNotes("Teachers do everything from the phone: attendance, their routine, leave, papers and marks.");

// 6. Parents
s = pres.addSlide({ masterName: "DARK", sectionTitle: "Product" });
s.addText("FOR PARENTS", { x: 0.6, y: 0.4, w: 6, h: 0.3, fontSize: 11, bold: true, color: C.accent6, margin: 0, charSpacing: 3, isTextBox: true, objectName: "kicker" });
s.addText("Answers without calling the school", { x: 0.6, y: 0.75, w: 6.2, h: 1.2, fontSize: 32, bold: true, color: C.background1, margin: 0, isTextBox: true, objectName: "title" });
["Attendance, last result and fees due at a glance", "Pay now with UPI; receipts download to the phone", "Subject-wise marks and the report card", "Attendance calendar; switch between children", "A numbered request thread to the office or class teacher"].forEach((t, i) => check(s, 0.6, 2.3 + i * 0.55, t, true));
[["01-parent-home", 7.0], ["17-parent-exam-result", 9.1], ["02-parent-message-school", 11.2]].forEach(([n, x], i) => s.addImage({ path: img(n), x, y: 1.75 + (i === 1 ? -0.25 : 0.2), w: 1.95, h: 1.95 * (1728 / 884) }));
s.addNotes("Parents stop calling: fees, results, attendance and notices are in the app; questions go into a tracked thread.");

// 7. Fees deep dive
s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Product" });
kickerTitle(s, "Fees & collections", "From invoice to receipt without a register");
s.addImage({ path: img("11-office-fees-report"), x: 0.5, y: 1.5, w: 7.6, h: 7.6 * (1130 / 1762) });
s.addImage({ path: img("10-office-collect-fee"), x: 7.5, y: 1.3, w: 2.1, h: 2.1 * (1728 / 884) });
["Fee structures, late rules, add-ons", "Billed vs collected vs outstanding", "Overdue list: who to call first", "Pay links and auto reminders", "Receipts with stamp, signature and QR"].forEach((t, i) => check(s, 9.9, 1.9 + i * 0.62, t, false, 3.1));
s.addNotes("Fees are the number one reason schools buy. Show the funnel: billed, collected, outstanding, and the overdue list.");

// 8. Routine + Exams
s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Product" });
kickerTitle(s, "Routine & exams", "A routine that knows every teacher's day");
s.addImage({ path: img("14-office-routine-desktop-v2"), x: 0.5, y: 1.5, w: 7.9, h: 7.9 * (1047 / 1762) });
s.addText("Routine", { x: 8.8, y: 1.6, w: 4, h: 0.4, fontSize: 18, bold: true, color: C.text1, margin: 0, isTextBox: true, objectName: "routine head" });
["Per-class and per-teacher views, PDF export", "Auto-fill empty periods from targets", "Substitutions when a teacher is on leave"].forEach((t, i) => check(s, 8.8, 2.1 + i * 0.5, t, false, 4.0));
s.addText("Exams", { x: 8.8, y: 3.9, w: 4, h: 0.4, fontSize: 18, bold: true, color: C.text1, margin: 0, isTextBox: true, objectName: "exams head" });
["Dates and timings across classes", "Paper setter / checker deadlines, handover", "Publish once every mark is in", "Report cards parents can download"].forEach((t, i) => check(s, 8.8, 4.4 + i * 0.5, t, false, 4.0));
s.addNotes("The routine knows teacher load and free periods. Exams run on deadlines and publish only when complete.");

// 9. Documents + website
s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Product" });
kickerTitle(s, "Documents & your website", "Everything looks like it came from your school");
s.addImage({ path: img("13-fee-receipt"), x: 0.5, y: 1.55, w: 6.0, h: 6.0 * (1044 / 1762) });
s.addImage({ path: img("16-school-website"), x: 6.8, y: 1.55, w: 6.0, h: 6.0 * (1037 / 1762) });
s.addText("Receipts, report cards and ID cards print with your letterhead, stamp and signature.", { x: 0.6, y: 5.3, w: 5.8, h: 0.8, fontSize: 14, color: C.text2, margin: 0, isTextBox: true, objectName: "doc caption" });
s.addText("A public school website with admissions built in — enquiries land in the office pipeline.", { x: 6.9, y: 5.3, w: 5.8, h: 0.8, fontSize: 14, color: C.text2, margin: 0, isTextBox: true, objectName: "site caption" });
s.addNotes("Every school gets a website on its own address; admission enquiries flow straight into the CRM.");

// 10. Modules grid
s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Product" });
kickerTitle(s, "Everything, connected", "Modules that already know each other");
const mods = [["Admissions", "Leads, follow-ups, tests, Excel import"], ["Fees", "Invoices, UPI, receipts, reminders"], ["Attendance", "Class register, QR check-in, month view"], ["Exams", "Timings, papers, marks, report cards"], ["Routine", "Drag-and-drop, clash detection, PDF"], ["Parent inbox", "Request threads, notices, WhatsApp-ready"], ["Staff & leave", "Balances, approvals, payroll with proof"], ["Roles", "Who can view or edit each area"], ["School website", "Public site with admissions"], ["Documents", "Letterhead, stamp, signature, ID cards"], ["Notices", "Preview, then send to any group"], ["Student portal", "Today, timetable, papers, fees"]];
mods.forEach((m, i) => {
  const col = i % 4, row = Math.floor(i / 4), x = 0.6 + col * 3.1, y = 1.7 + row * 1.65;
  s.addShape(pres.ShapeType.roundRect, { x, y, w: 2.9, h: 1.45, fill: { color: C.background1 }, line: { color: "E3E9F3", width: 1 }, rectRadius: 0.16, shadow: { type: "outer", blur: 10, offset: 3, angle: 90, color: "0B1530", opacity: 0.07 } });
  s.addShape(pres.ShapeType.ellipse, { x: x + 0.25, y: y + 0.25, w: 0.34, h: 0.34, fill: { color: [C.accent1, C.accent2, C.accent3, C.accent4][col] } });
  s.addText(m[0], { x: x + 0.7, y: y + 0.2, w: 2.1, h: 0.45, fontSize: 16, bold: true, color: C.text1, margin: 0, valign: "middle", isTextBox: true, objectName: `module ${i + 1}` });
  s.addText(m[1], { x: x + 0.25, y: y + 0.72, w: 2.5, h: 0.65, fontSize: 12, color: C.text2, margin: 0, isTextBox: true, objectName: `module body ${i + 1}` });
});
s.addNotes("Twelve modules, one record. Nothing here is a separate product to integrate.");

// 11. Get started
pres.addSection({ title: "Close" });
s = pres.addSlide({ masterName: "LIGHT", sectionTitle: "Close" });
kickerTitle(s, "Get started", "Three ways to begin");
const paths = [["▶", "Book a demo", "20 minutes online. See the complete ERP on web and Android, ask questions live.", "No payment"], ["14", "Free trial", "Try Anekio for 14 days with your own school data. No card needed.", "Most popular"], ["₹", "Launch now", "Annual plan with setup support included. Pay by UPI or card.", "Launch offer"]];
paths.forEach((p, i) => {
  const x = 0.6 + i * 4.15, pop = i === 1;
  s.addShape(pres.ShapeType.roundRect, { x, y: 1.8, w: 3.9, h: 3.6, fill: { color: pop ? C.accent1 : C.background1 }, line: { color: pop ? C.accent1 : "E3E9F3", width: 1 }, rectRadius: 0.22, shadow: { type: "outer", blur: 16, offset: 5, angle: 90, color: "0B1530", opacity: pop ? 0.2 : 0.08 } });
  s.addShape(pres.ShapeType.roundRect, { x: x + 0.35, y: 2.15, w: 0.8, h: 0.8, fill: { color: pop ? "FFFFFF" : "EEF4FF" }, line: { color: pop ? "FFFFFF" : "EEF4FF" }, rectRadius: 0.2 });
  s.addText(p[0], { x: x + 0.35, y: 2.15, w: 0.8, h: 0.8, fontSize: 22, bold: true, color: C.accent1, align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: `path icon ${i + 1}` });
  s.addText(p[3], { x: x + 1.4, y: 2.3, w: 2.2, h: 0.4, fontSize: 11, bold: true, color: pop ? "DBE6FF" : C.accent3, margin: 0, charSpacing: 2, isTextBox: true, objectName: `path tag ${i + 1}` });
  s.addText(p[1], { x: x + 0.35, y: 3.2, w: 3.2, h: 0.5, fontSize: 22, bold: true, color: pop ? "FFFFFF" : C.text1, margin: 0, isTextBox: true, objectName: `path title ${i + 1}` });
  s.addText(p[2], { x: x + 0.35, y: 3.75, w: 3.2, h: 1.4, fontSize: 14, color: pop ? "E6EDFF" : C.text2, margin: 0, isTextBox: true, objectName: `path body ${i + 1}` });
});
s.addText("anekio.com  ·  support@anekio.com", { x: 0.6, y: 5.8, w: 12, h: 0.5, fontSize: 18, bold: true, color: C.accent1, margin: 0, isTextBox: true, objectName: "contact" });
s.addNotes("Close with the three paths. Trial is the default recommendation.");

// 12. Thank you
s = pres.addSlide({ masterName: "DARK", sectionTitle: "Close" });
s.addImage({ path: "assets/mark.png", x: 0.7, y: 2.2, w: 1.0, h: 1.0 });
s.addText("One platform.\nOne school record.\nEvery team connected.", { x: 0.7, y: 3.4, w: 7, h: 2.2, fontSize: 36, bold: true, color: C.background1, margin: 0, isTextBox: true, objectName: "closing", lineSpacingMultiple: 1.1 });
s.addText("anekio.com  ·  support@anekio.com", { x: 0.7, y: 5.8, w: 7, h: 0.5, fontSize: 16, color: C.accent2, margin: 0, isTextBox: true, objectName: "contact" });
[["12-office-dashboard-cover", 7.9, 1.5], ["05-teacher-attendance", 9.75, 1.1], ["01-parent-home", 11.6, 1.5]].forEach(([n, x, y]) => s.addImage({ path: img(n), x, y, w: 1.7, h: 1.7 * (1728 / 884) }));
s.addNotes("Thank you.");

(async () => {
  await pres.writeFile({ fileName: "Anekio-School-ERP.pptx" });
  await applyTheme("Anekio-School-ERP.pptx", THEME);
  console.log("written");
})();
