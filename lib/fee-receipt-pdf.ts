import { prisma } from "./prisma";
import { feeLineTotal, parseFeeLines } from "./fees";
import { schoolFromConfig, schoolLines } from "./school";
import {
  BLUE,
  GREEN,
  GREEN_SOFT,
  INK,
  LINE,
  MARGIN,
  MUTED,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  SOFT,
  cleanText,
  dateLabel,
  line,
  makePdf,
  money,
  rect,
  row,
  text,
  type PdfCommand,
} from "./saas-invoice-pdf";

const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK: "Bank transfer",
  CHEQUE: "Cheque",
  RAZORPAY: "Online",
  CASHFREE: "Online",
  BILLDESK: "Online",
};

function referenceBase(reference?: string | null) {
  const value = String(reference || "").trim();
  return value ? value.split(":")[0] || value : "";
}

/**
 * Fee receipt PDF for one or more invoices of the same student, addressed by their share tokens.
 * Used by the WhatsApp / share receipt links: /pay/receipt/<token>[,<token>...]
 */
export async function feeReceiptPdf(tokens: string[]) {
  const wanted = [...new Set(tokens.map((t) => t.trim()).filter(Boolean))].slice(0, 24);
  if (!wanted.length) return null;
  const invoices = await prisma.feeInvoice.findMany({
    where: { shareToken: { in: wanted } },
    include: { payments: true, student: { include: { class: true, parent: { include: { user: true } } } } },
    orderBy: { dueDate: "asc" },
  });
  if (!invoices.length) return null;
  const student = invoices[0].student;
  if (invoices.some((inv) => inv.studentId !== student.id)) return null;
  const payments = invoices.flatMap((inv) => inv.payments.map((p) => ({ ...p, invoiceTitle: inv.title })));
  if (!payments.length) return null;

  const orgId = invoices[0].orgId || student.orgId;
  const config = (orgId ? await prisma.schoolConfig.findFirst({ where: { orgId } }) : null) || (await prisma.schoolConfig.findUnique({ where: { id: "school" } }));
  const school = schoolFromConfig(config as never);
  const latest = [...payments].sort((a, b) => +b.paidAt - +a.paidAt)[0];
  const receiptNo = (referenceBase(latest.reference) || `RCPT-${latest.id.slice(-8)}`).toUpperCase();
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const totalBilled = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  const balance = Math.max(0, totalBilled - totalPaid);
  const methods = [...new Set(payments.map((p) => METHOD_LABEL[String(p.method)] || String(p.method)))].join(", ");
  const refs = [...new Set(payments.map((p) => referenceBase(p.reference)).filter(Boolean))];
  const userRef = refs.find((r) => !r.startsWith("RCPT-")) || "";

  const c: PdfCommand[] = [];
  const W = PAGE_WIDTH - MARGIN * 2;
  rect(c, 0, 0, PAGE_WIDTH, PAGE_HEIGHT, { fill: "1 1 1" });

  // Header band
  rect(c, MARGIN, PAGE_HEIGHT - 132, W, 94, { fill: BLUE });
  text(c, school.name, MARGIN + 18, PAGE_HEIGHT - 72, 20, { bold: true, color: "1 1 1", maxWidth: 330 });
  schoolLines(school)
    .slice(0, 3)
    .forEach((part, i) => text(c, part, MARGIN + 18, PAGE_HEIGHT - 90 - i * 11, 8, { color: "0.86 0.93 1", maxWidth: 330 }));
  text(c, "FEE RECEIPT", MARGIN + W - 170, PAGE_HEIGHT - 72, 18, { bold: true, color: "1 1 1", align: "right", maxWidth: 160 });
  text(c, "Receipt No.", MARGIN + W - 170, PAGE_HEIGHT - 92, 8, { color: "0.86 0.93 1", align: "right", maxWidth: 160 });
  text(c, receiptNo, MARGIN + W - 190, PAGE_HEIGHT - 106, 10, { bold: true, color: "1 1 1", align: "right", maxWidth: 180 });
  rect(c, MARGIN + W - 96, PAGE_HEIGHT - 127, 80, 16, { fill: GREEN_SOFT, stroke: "0.74 0.91 0.80" });
  text(c, balance > 0 ? "PART PAID" : "PAID", MARGIN + W - 96, PAGE_HEIGHT - 122, 8.5, { bold: true, color: GREEN, align: "center", maxWidth: 80 });

  // Student + receipt details
  let y = PAGE_HEIGHT - 156;
  const colW = (W - 14) / 2;
  rect(c, MARGIN, y - 86, colW, 86, { stroke: LINE });
  rect(c, MARGIN + colW + 14, y - 86, colW, 86, { stroke: LINE });
  text(c, "RECEIVED FROM", MARGIN + 10, y - 18, 8.5, { bold: true, color: MUTED });
  text(c, student.name, MARGIN + 10, y - 36, 13, { bold: true, maxWidth: colW - 20 });
  text(c, [student.class ? [student.class.name, student.class.section].filter(Boolean).join("-") : "", student.admissionNo ? `Adm. ${student.admissionNo}` : ""].filter(Boolean).join(" | "), MARGIN + 10, y - 52, 8.5, { color: MUTED, maxWidth: colW - 20 });
  const parentName = student.parent?.user?.name || "";
  if (parentName) text(c, `Parent: ${parentName}`, MARGIN + 10, y - 66, 8.5, { color: MUTED, maxWidth: colW - 20 });
  text(c, "PAYMENT", MARGIN + colW + 24, y - 18, 8.5, { bold: true, color: MUTED });
  row(c, "Date", dateLabel(latest.paidAt), MARGIN + colW + 24, y - 36, colW - 20);
  row(c, "Mode", methods || "-", MARGIN + colW + 24, y - 50, colW - 20);
  row(c, "UTR / Ref.", userRef || "-", MARGIN + colW + 24, y - 64, colW - 20);
  row(c, "Receipt No.", receiptNo, MARGIN + colW + 24, y - 78, colW - 20);

  // Fee lines table
  y -= 110;
  rect(c, MARGIN, y - 24, W, 24, { fill: SOFT, stroke: LINE });
  text(c, "DESCRIPTION", MARGIN + 10, y - 16, 8, { bold: true, color: MUTED });
  text(c, "AMOUNT", MARGIN + W - 130, y - 16, 8, { bold: true, color: MUTED, align: "right", maxWidth: 120 });
  y -= 24;
  const rows: { label: string; value: number; sub?: boolean }[] = [];
  for (const inv of invoices) {
    const lines = feeLineTotal(parseFeeLines(inv.linesJson)).rows.filter((r) => r.value);
    rows.push({ label: inv.title, value: inv.amount });
    if (lines.length > 1) for (const l of lines.slice(0, 8)) rows.push({ label: `   ${l.label}`, value: l.value, sub: true });
  }
  for (const r of rows.slice(0, 26)) {
    rect(c, MARGIN, y - 20, W, 20, { stroke: LINE });
    text(c, r.label, MARGIN + 10, y - 13.5, r.sub ? 8 : 9, { bold: !r.sub, color: r.sub ? MUTED : INK, maxWidth: W - 160 });
    text(c, money(r.value), MARGIN + W - 130, y - 13.5, r.sub ? 8 : 9, { bold: !r.sub, color: r.sub ? MUTED : INK, align: "right", maxWidth: 120 });
    y -= 20;
  }

  // Totals
  y -= 14;
  const tx = MARGIN + W - 230;
  [
    ["Total billed", money(totalBilled)],
    ["Amount received", money(totalPaid)],
    ["Balance", money(balance)],
  ].forEach(([label, value], i) => {
    const ry = y - 16 - i * 20;
    if (i === 1) rect(c, tx, ry - 7, 230, 20, { fill: GREEN_SOFT });
    row(c, label, value, tx + 10, ry, 210);
    if (i < 2) line(c, tx, ry - 9, tx + 230, ry - 9);
  });
  rect(c, tx, y - 62, 230, 62, { stroke: LINE });

  // Footer
  text(c, `For ${cleanText(school.name)}`, MARGIN + W - 210, 120, 8.5, { bold: true, align: "right", maxWidth: 210 });
  line(c, MARGIN + W - 130, 84, MARGIN + W, 84, INK);
  text(c, school.signatory || "Authorised signatory", MARGIN + W - 130, 70, 8.5, { bold: true, align: "center", maxWidth: 130 });
  text(c, "This is a computer generated receipt and does not need a signature.", MARGIN, 40, 8, { color: MUTED });

  const safe = cleanText(`${receiptNo}-${student.name}`).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-");
  return { filename: `Receipt-${safe}.pdf`, receiptNo, buffer: makePdf(c.join("\n")) };
}
