import { prisma } from "./prisma";

type PdfCommand = string;

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const INK = "0.07 0.12 0.20";
const MUTED = "0.36 0.43 0.53";
const BLUE = "0.07 0.23 0.40";
const LINE = "0.83 0.87 0.92";
const SOFT = "0.95 0.97 0.99";
const GREEN = "0.04 0.46 0.28";
const GREEN_SOFT = "0.92 0.99 0.95";

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[–—]/g, "-")
    .replace(/[•·]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function pdfEscape(value: unknown) {
  return cleanText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function money(value: number) {
  return `Rs. ${Math.round(value).toLocaleString("en-IN")}`;
}

function tableMoney(value: number) {
  return Math.round(value).toLocaleString("en-IN");
}

function dateLabel(value: Date | string | null | undefined) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function statusLabel(value: string) {
  return value ? value.replaceAll("_", " ") : "Not recorded";
}

function stateCodeFor(state: string) {
  const normalized = state.trim().toLowerCase();
  if (normalized === "karnataka") return "29";
  return "";
}

function wrapText(value: string, maxChars: number, maxLines = 2) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : [""];
}

function ellipsize(value: unknown, maxChars: number) {
  const content = cleanText(value);
  return content.length > maxChars ? `${content.slice(0, Math.max(0, maxChars - 3))}...` : content;
}

function fitForWidth(value: unknown, size: number, maxWidth?: number) {
  const content = cleanText(value);
  if (!maxWidth) return content;
  const maxChars = Math.max(3, Math.floor(maxWidth / (size * 0.56)));
  return ellipsize(content, maxChars);
}

function text(commands: PdfCommand[], value: unknown, x: number, y: number, size = 10, options?: { bold?: boolean; color?: string; align?: "left" | "right" | "center"; maxWidth?: number }) {
  const font = options?.bold ? "F2" : "F1";
  const content = fitForWidth(value, size, options?.maxWidth);
  const width = options?.maxWidth ?? content.length * size * 0.48;
  const estimated = content.length * size * 0.62;
  const tx = options?.align === "right" ? x + width - estimated : options?.align === "center" ? x + (width - estimated) / 2 : x;
  commands.push(`${options?.color ?? INK} rg BT /${font} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscape(content)}) Tj ET`);
}

function line(commands: PdfCommand[], x1: number, y1: number, x2: number, y2: number, color = LINE, width = 1) {
  commands.push(`${color} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
}

function rect(commands: PdfCommand[], x: number, y: number, w: number, h: number, options?: { stroke?: string; fill?: string; width?: number }) {
  if (options?.fill) commands.push(`${options.fill} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  if (options?.stroke !== undefined) commands.push(`${options.stroke} RG ${options.width ?? 1} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
}

function row(commands: PdfCommand[], label: string, value: string, x: number, y: number, width: number) {
  text(commands, label, x, y, 9, { color: MUTED });
  text(commands, value, x, y, 9, { bold: true, align: "right", maxWidth: width });
}

function makePdf(stream: string) {
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >> endobj\n`,
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n",
    `6 0 obj << /Length ${Buffer.byteLength(stream, "latin1")} >> stream\n${stream}\nendstream endobj\n`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export async function adminInvoicePdf(id: string) {
  const invoice = await prisma.saasInvoice.findUnique({ where: { id }, include: { org: true, payments: { orderBy: { paidAt: "desc" } } } });
  if (!invoice) return null;

  const supplier = {
    legalName: "Anekio Technologies Private Limited",
    tradeName: "Anekio",
    address: "2nd Floor, 18 Residency Road, Bengaluru, Karnataka 560025",
    state: "Karnataka",
    stateCode: "29",
    gstin: "29AAICA0000A1Z5",
    pan: "AAICA0000A",
    email: "billing@anekio.in",
    phone: "+91 80 4000 1200",
    sac: "998314",
  };
  const customerState = invoice.org.billingState || invoice.org.city || "";
  const sameState = customerState.trim().toLowerCase() === supplier.state.toLowerCase() || stateCodeFor(customerState) === supplier.stateCode;
  const halfTax = Math.round(invoice.taxAmount / 2);
  const taxRows = invoice.taxAmount
    ? sameState
      ? [["CGST", `${invoice.taxPercent / 2}%`, halfTax], ["SGST", `${invoice.taxPercent / 2}%`, invoice.taxAmount - halfTax]]
      : [["IGST", `${invoice.taxPercent}%`, invoice.taxAmount]]
    : [["GST", "0%", 0]];
  const balance = Math.max(0, invoice.total - invoice.paidAmount);
  const latestPayment = invoice.payments.find((payment) => payment.status === "PAID") || invoice.payments[0];
  const commands: PdfCommand[] = [];
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  rect(commands, 0, 0, PAGE_WIDTH, PAGE_HEIGHT, { fill: "1 1 1" });
  rect(commands, MARGIN, PAGE_HEIGHT - 142, contentWidth, 104, { fill: BLUE });
  rect(commands, MARGIN + 18, PAGE_HEIGHT - 118, 50, 50, { fill: "1 1 1", stroke: "1 1 1" });
  rect(commands, MARGIN + 24, PAGE_HEIGHT - 112, 38, 38, { fill: "0.16 0.34 0.96", stroke: "0.16 0.34 0.96" });
  text(commands, "AN", MARGIN + 24, PAGE_HEIGHT - 89, 17, { bold: true, color: "1 1 1", align: "center", maxWidth: 38 });
  text(commands, supplier.tradeName, MARGIN + 84, PAGE_HEIGHT - 76, 24, { bold: true, color: "1 1 1", maxWidth: 238 });
  text(commands, supplier.legalName, MARGIN + 84, PAGE_HEIGHT - 94, 8.5, { bold: true, color: "0.86 0.93 1", maxWidth: 238 });
  text(commands, supplier.address, MARGIN + 84, PAGE_HEIGHT - 108, 7.5, { color: "0.86 0.93 1", maxWidth: 245 });
  text(commands, `GSTIN: ${supplier.gstin} | PAN: ${supplier.pan}`, MARGIN + 84, PAGE_HEIGHT - 121, 7.5, { color: "0.86 0.93 1", maxWidth: 245 });
  text(commands, "TAX INVOICE", MARGIN + contentWidth - 168, PAGE_HEIGHT - 76, 20, { bold: true, color: "1 1 1", align: "right", maxWidth: 168 });
  text(commands, "Invoice No.", MARGIN + contentWidth - 152, PAGE_HEIGHT - 98, 8, { color: "0.86 0.93 1", align: "right", maxWidth: 152 });
  text(commands, invoice.number, MARGIN + contentWidth - 174, PAGE_HEIGHT - 113, 9.5, { bold: true, color: "1 1 1", align: "right", maxWidth: 174 });
  rect(commands, MARGIN + contentWidth - 116, PAGE_HEIGHT - 136, 100, 20, { fill: GREEN_SOFT, stroke: "0.74 0.91 0.80" });
  text(commands, statusLabel(invoice.status), MARGIN + contentWidth - 116, PAGE_HEIGHT - 129, 9, { bold: true, color: GREEN, align: "center", maxWidth: 100 });

  let y = PAGE_HEIGHT - 166;
  const colW = (contentWidth - 14) / 2;
  rect(commands, MARGIN, y - 94, colW, 94, { stroke: LINE });
  rect(commands, MARGIN + colW + 14, y - 94, colW, 94, { stroke: LINE });
  text(commands, "BILL TO", MARGIN + 10, y - 18, 9, { bold: true, color: MUTED });
  text(commands, invoice.org.schoolName, MARGIN + 10, y - 36, 13, { bold: true });
  wrapText(invoice.org.billingAddress || invoice.org.city || "Billing address not configured", 58, 2).forEach((part, index) => {
    text(commands, part, MARGIN + 10, y - 52 - index * 11, 8, { color: MUTED });
  });
  text(commands, `${invoice.org.ownerEmail} | ${invoice.org.ownerPhone}`, MARGIN + 10, y - 76, 8, { color: MUTED });
  if (invoice.org.gstin) text(commands, `GSTIN: ${invoice.org.gstin}`, MARGIN + 10, y - 88, 8, { color: MUTED });
  text(commands, "INVOICE DETAILS", MARGIN + colW + 24, y - 18, 9, { bold: true, color: MUTED });
  row(commands, "Invoice date", dateLabel(invoice.issueDate), MARGIN + colW + 24, y - 36, colW - 20);
  row(commands, "Due date", dateLabel(invoice.dueDate), MARGIN + colW + 24, y - 50, colW - 20);
  row(commands, "Place of supply", customerState || "Not configured", MARGIN + colW + 24, y - 64, colW - 20);
  row(commands, "Supplier state", `${supplier.state} (${supplier.stateCode})`, MARGIN + colW + 24, y - 78, colW - 20);

  y -= 118;
  const tableX = MARGIN;
  const widths = [210, 48, 32, 58, 70, 34, contentWidth - 452];
  const starts = widths.reduce<number[]>((acc, width, index) => {
    acc.push(index ? acc[index - 1] + widths[index - 1] : tableX);
    return acc;
  }, []);
  rect(commands, tableX, y - 28, contentWidth, 28, { fill: SOFT, stroke: LINE });
  ["DESCRIPTION", "SAC", "QTY", "RATE", "TAXABLE", "GST", "AMOUNT"].forEach((heading, index) => {
    const align = index < 2 ? "left" : "right";
    text(commands, heading, starts[index] + 6, y - 18, 7, { bold: true, color: MUTED, align, maxWidth: widths[index] - 10 });
    if (index) line(commands, starts[index], y, starts[index], y - 66);
  });
  rect(commands, tableX, y - 66, contentWidth, 38, { stroke: LINE });
  text(commands, invoice.description, starts[0] + 6, y - 43, 9, { bold: true, maxWidth: widths[0] - 12 });
  text(commands, "Subscription and support services", starts[0] + 6, y - 56, 7.2, { color: MUTED, maxWidth: widths[0] - 12 });
  text(commands, supplier.sac, starts[1] + 6, y - 47, 8.2, { maxWidth: widths[1] - 10 });
  text(commands, String(invoice.quantity), starts[2] + 4, y - 47, 8.2, { align: "right", maxWidth: widths[2] - 8 });
  text(commands, tableMoney(invoice.unitPrice), starts[3] + 4, y - 47, 8.2, { align: "right", maxWidth: widths[3] - 8 });
  text(commands, tableMoney(invoice.subtotal), starts[4] + 4, y - 47, 8.2, { align: "right", maxWidth: widths[4] - 8 });
  text(commands, `${invoice.taxPercent}%`, starts[5] + 4, y - 47, 8.2, { align: "right", maxWidth: widths[5] - 8 });
  text(commands, money(invoice.total), starts[6] + 4, y - 47, 8.2, { bold: true, align: "right", maxWidth: widths[6] - 8 });

  y -= 92;
  rect(commands, MARGIN, y - 108, colW, 108, { stroke: LINE });
  rect(commands, MARGIN, y - 36, colW, 28, { fill: SOFT, stroke: LINE });
  text(commands, "GST SUMMARY", MARGIN + 10, y - 18, 9, { bold: true, color: MUTED });
  text(commands, "TAX", MARGIN + 12, y - 54, 8, { bold: true, color: MUTED });
  text(commands, "RATE", MARGIN + 108, y - 54, 8, { bold: true, color: MUTED });
  text(commands, "AMOUNT", MARGIN + 156, y - 54, 8, { bold: true, color: MUTED, align: "right", maxWidth: 78 });
  taxRows.forEach(([name, rate, amount], index) => {
    const rowY = y - 72 - index * 18;
    text(commands, String(name), MARGIN + 12, rowY, 9, { bold: true });
    text(commands, String(rate), MARGIN + 122, rowY, 9);
    text(commands, money(Number(amount)), MARGIN + 156, rowY, 9, { align: "right", maxWidth: 78 });
  });
  const totalsX = MARGIN + 276;
  rect(commands, totalsX, y - 100, contentWidth - 276, 100, { stroke: LINE });
  [
    ["Taxable value", money(invoice.subtotal)],
    ["Total GST", money(invoice.taxAmount)],
    ["Total invoice value", money(invoice.total)],
    ["Amount received", money(invoice.paidAmount)],
    ["Balance due", money(balance)],
  ].forEach(([label, value], index) => {
    const rowY = y - 18 - index * 18;
    if (index === 2) rect(commands, totalsX, rowY - 7, contentWidth - 276, 18, { fill: "0.94 0.97 1" });
    row(commands, label, value, totalsX + 10, rowY, contentWidth - 296);
    if (index < 4) line(commands, totalsX, rowY - 10, MARGIN + contentWidth, rowY - 10);
  });

  y -= 130;
  rect(commands, MARGIN, y - 86, colW, 86, { stroke: LINE });
  rect(commands, MARGIN + colW + 14, y - 86, colW, 86, { stroke: LINE });
  text(commands, "PAYMENT DETAILS", MARGIN + 10, y - 18, 9, { bold: true, color: MUTED });
  row(commands, "Status", statusLabel(invoice.status), MARGIN + 10, y - 36, colW - 20);
  row(commands, "Method", ellipsize(latestPayment?.provider || "Not recorded", 18), MARGIN + 10, y - 50, colW - 20);
  row(commands, "Reference", ellipsize(latestPayment?.paymentId || latestPayment?.orderId || "Not recorded", 20), MARGIN + 10, y - 64, colW - 20);
  row(commands, "Received on", dateLabel(latestPayment?.paidAt || latestPayment?.createdAt), MARGIN + 10, y - 78, colW - 20);
  text(commands, "BANK / UPI", MARGIN + colW + 24, y - 18, 9, { bold: true, color: MUTED });
  text(commands, "Account name: Anekio Technologies Private Limited", MARGIN + colW + 24, y - 38, 8);
  text(commands, "Bank: Configure in Anekio admin", MARGIN + colW + 24, y - 52, 8);
  text(commands, "UPI: billing@anekio", MARGIN + colW + 24, y - 66, 8);
  text(commands, "Use invoice number as payment reference.", MARGIN + colW + 24, y - 80, 8, { color: MUTED });

  y -= 124;
  if (invoice.notes) {
    rect(commands, MARGIN, y - 42, contentWidth, 42, { stroke: LINE });
    text(commands, "NOTES", MARGIN + 10, y - 17, 9, { bold: true, color: MUTED });
    text(commands, invoice.notes, MARGIN + 10, y - 32, 8);
  }
  text(commands, `For ${supplier.legalName}`, MARGIN + contentWidth - 210, 122, 8, { bold: true, align: "right", maxWidth: 210 });
  rect(commands, MARGIN + contentWidth - 198, 72, 64, 36, { stroke: "0.50 0.62 0.78" });
  text(commands, "ANEKIO", MARGIN + contentWidth - 196, 94, 8, { bold: true, color: BLUE, align: "center", maxWidth: 60 });
  text(commands, "STAMP", MARGIN + contentWidth - 196, 82, 7, { bold: true, color: MUTED, align: "center", maxWidth: 60 });
  line(commands, MARGIN + contentWidth - 112, 78, MARGIN + contentWidth, 78, INK);
  text(commands, "Authorised signatory", MARGIN + contentWidth - 112, 62, 9, { bold: true, align: "center", maxWidth: 112 });
  text(commands, "This is a computer generated tax invoice for subscription services. Keep this invoice for accounting, GST reconciliation, and renewal records.", MARGIN, 38, 8, { color: MUTED });

  return { filename: `${cleanText(invoice.number).replace(/[^A-Za-z0-9._-]/g, "-")}.pdf`, buffer: makePdf(commands.join("\n")) };
}
