/**
 * "Admission kit": what the office sends a family right after admitting a student, in one WhatsApp message.
 * - the admission confirmation (issued once, reused after that), listing the documents the school received;
 * - the admission fee receipt (fee taken) or its pay link (fee still due);
 * - the files uploaded on the admission form, as signed links that expire after 7 days (no public file URLs);
 * - the parent app link.
 * Nothing new is stored: file links are HMAC-signed tokens checked by GET /files/s/:token.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { admissionCustomValues, admissionFormFields } from "./admission-form";
import { configuredAdmissionFormJson } from "./admission-form-config";
import { createParentSetPasswordLink } from "./auth-challenges";
import { assertStudentAccess, CLASS_STUDENTS_ADD, CLASS_STUDENTS_EDIT } from "./class-teacher-access";
import { ensureInvoiceShareTokenCore } from "./core-actions";
import { issueDocumentCore } from "./document-studio";
import { can, type AccessUser } from "./permissions";
import { prisma } from "./prisma";
import { runWithoutTenant, setTenantOrg } from "./tenant-context";
import { schoolFromConfig } from "./school";
import { publicOrigin } from "./utils";
import { FIELD_VALUES_INCLUDE, studentAnswersFrom } from "./custom-fields";

const FILE_LINK_DAYS = 7;
const PLAY_URL = "https://play.google.com/store/apps/details?id=in.anekio.school";
/** ID proofs are not sent unless the office ticks them. */
const ID_PROOF = /aadh?aa?r|\bpan\b|passport|voter|id proof|identity/i;

function secret() {
  const s = process.env.JWT_SECRET || process.env.APP_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("JWT_SECRET is missing");
  return s;
}

function sign(body: string) {
  return createHmac("sha256", secret()).update(`admission-file:${body}`).digest("base64url");
}

export function signedFileToken(path: string, name: string, days = FILE_LINK_DAYS) {
  const body = Buffer.from(JSON.stringify({ p: path, n: name, e: Date.now() + days * 86_400_000 })).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The file a signed link points to, or null when the link is forged or expired. */
export function readSignedFileToken(token: string): { path: string; name: string } | null {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { p?: string; n?: string; e?: number };
    if (!value.p || !value.e || value.e < Date.now()) return null;
    return { path: String(value.p), name: String(value.n || "document") };
  } catch {
    return null;
  }
}

function fileExtension(path: string) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(path);
  return m ? `.${m[1].toLowerCase()}` : "";
}

/** The school's admission-form file fields: what was received and what is still pending. */
/** `student` must include FIELD_VALUES_INCLUDE (and the photoPath column). */
export async function admissionFilesFor(student: object) {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { admissionFormJson: true } });
  const fields = admissionFormFields(await configuredAdmissionFormJson(config?.admissionFormJson)).filter(
    (field) => field.type === "file" && !field.builtin && field.visible
  );
  const values = studentAnswersFrom(student);
  return fields.map((field) => ({ id: field.id, label: field.label, path: values[field.id] || "", required: field.required }));
}

export type AdmissionKit = {
  student: { id: string; name: string; admissionNo: string; classLabel: string };
  parent: { name: string; phone: string; setPasswordUrl?: string } | null;
  confirmation: { url: string; number: string } | null;
  confirmationError?: string;
  fee: { kind: "receipt" | "invoice"; label: string; amount: number; url: string } | null;
  files: { id: string; label: string; url: string; idProof: boolean }[];
  pending: string[];
  appUrl: string;
  webUrl: string;
};

export async function admissionKitCore(user: AccessUser, input: { studentId?: string }): Promise<AdmissionKit> {
  const studentId = String(input.studentId || "").trim();
  if (!studentId) throw new Error("Choose a student.");
  await assertStudentAccess(user, studentId, [CLASS_STUDENTS_ADD, CLASS_STUDENTS_EDIT]);
  const student = await prisma.student.findFirst({
    where: { id: studentId },
    include: { class: { select: { name: true, section: true } }, parent: { include: { user: { select: { name: true, phone: true } } } }, ...FIELD_VALUES_INCLUDE },
  });
  if (!student) throw new Error("Student not found.");
  const classLabel = `${student.class.name}-${student.class.section}`;
  const parentPhone = student.parent?.phone || student.parent?.user.phone || "";
  // A one-time "set your password" link (7 days) so the family never needs a shared default password.
  // Office only: whoever holds the link can set that parent's password.
  const setPasswordUrl = student.parent && can(user, "people.edit")
    ? await createParentSetPasswordLink(student.parent.userId, publicOrigin()).catch(() => "")
    : "";
  const parent = student.parent ? { name: student.parent.user.name, phone: parentPhone, ...(setPasswordUrl ? { setPasswordUrl } : {}) } : null;
  const files = await admissionFilesFor(student);
  const received = files.filter((file) => file.path);

  // Admission confirmation: reuse a valid one, else issue it (published template, or the built-in design).
  let confirmation: AdmissionKit["confirmation"] = null;
  let confirmationError = "";
  const existing = await prisma.issuedDocument.findFirst({
    where: { type: "ADMISSION_CONFIRMATION", status: "VALID", subjectType: "STUDENT", subjectId: student.id },
    orderBy: { issuedAt: "desc" },
    select: { verifyToken: true, documentNumber: true },
  });
  if (existing) {
    confirmation = { url: `${publicOrigin()}/documents/${existing.verifyToken}`, number: existing.documentNumber };
  } else if (can(user, "documents.issue") || can(user, "school.edit")) {
    try {
      const published = await prisma.documentTemplate.findFirst({
        where: { type: "ADMISSION_CONFIRMATION", status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
      const issued = await issueDocumentCore(user, {
        templateId: published?.id || "builtin:ADMISSION_CONFIRMATION",
        subjectType: "STUDENT",
        subjectId: student.id,
        subjectLabel: student.name,
        data: {
          school: schoolFromConfig(config),
          student: {
            id: student.id,
            name: student.name,
            admissionNo: student.admissionNo,
            classLabel,
            born: student.dateOfBirth ? student.dateOfBirth.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
            dateOfBirth: student.dateOfBirth ? student.dateOfBirth.toISOString().slice(0, 10) : "",
            parent: parent?.name || "",
            parentPhone,
          },
          document: {},
        },
      });
      confirmation = { url: issued.documentUrl, number: issued.documentNumber };
    } catch (error) {
      confirmationError = error instanceof Error ? error.message : "Could not issue the admission confirmation.";
    }
  } else {
    confirmationError = "Only the office can issue the admission confirmation.";
  }

  // Admission fee: receipt when it was taken, pay link when it is still due.
  let fee: AdmissionKit["fee"] = null;
  const invoice = await prisma.feeInvoice.findFirst({
    where: { studentId: student.id, period: `ADMISSION-${student.id}` },
    include: { payments: { include: { receipt: { select: { shareToken: true, receiptNo: true, status: true } } } } },
  });
  if (invoice) {
    const receipt = invoice.payments.map((payment) => payment.receipt).find((row) => row && row.status === "ACTIVE");
    if (receipt) {
      fee = { kind: "receipt", label: `Admission fee receipt ${receipt.receiptNo}`, amount: invoice.amount, url: `${publicOrigin()}/pay/r/${receipt.shareToken}` };
    } else if (invoice.status !== "PAID") {
      try {
        const token = await ensureInvoiceShareTokenCore(user, invoice.id);
        fee = { kind: "invoice", label: "Admission fee (pay online)", amount: invoice.amount, url: `${publicOrigin()}/pay/${token}` };
      } catch {
        fee = null;
      }
    }
  }

  return {
    student: { id: student.id, name: student.name, admissionNo: student.admissionNo, classLabel },
    parent,
    confirmation,
    ...(confirmationError ? { confirmationError } : {}),
    fee,
    files: received.map((file) => ({
      id: file.id,
      label: file.label,
      idProof: ID_PROOF.test(file.label),
      url: `${publicOrigin()}/files/d/${documentLinkToken(student.id, user.orgId ?? null, file.id)}`,
    })),
    pending: files.filter((file) => !file.path).map((file) => file.label),
    appUrl: PLAY_URL,
    webUrl: publicOrigin(),
  };
}

/* ---------- One lasting link per admission document ----------
 * Signed (student, school, form field) with no expiry. Each visit reads the student's current file for that
 * field, so a re-uploaded document shows the new file, and the link stops working once the student leaves. */

function signDoc(body: string) {
  return createHmac("sha256", secret()).update(`admission-doc:${body}`).digest("base64url");
}

export function documentLinkToken(studentId: string, orgId: string | null, fieldId: string) {
  const body = Buffer.from(JSON.stringify({ s: studentId, o: orgId, f: fieldId })).toString("base64url");
  return `${body}.${signDoc(body)}`;
}

/** The file behind a document link, or null when the link is forged, the student left, or the file is gone. */
export async function admissionDocumentFile(token: string): Promise<{ path: string; name: string } | null> {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(signDoc(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: { s?: string; o?: string | null; f?: string };
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!claims.s || !claims.f) return null;
  return runWithoutTenant(async () => {
    setTenantOrg(claims.o ?? null);
    const student = await prisma.student.findFirst({ where: { id: claims.s }, select: { photoPath: true, leftOn: true, ...FIELD_VALUES_INCLUDE } });
    if (!student || student.leftOn) return null;
    const file = (await admissionFilesFor(student)).find((row) => row.id === claims.f);
    if (!file?.path) return null;
    return { path: file.path, name: `${file.label}${fileExtension(file.path)}` };
  });
}

/* ---------- One multi-page "admission documents" page: confirmation first, then each chosen file ---------- */

/** e: expiry (ms). Links made from now on have none: they work while the student is still at the school. */
type KitClaims = { s: string; o: string | null; f: string[]; c?: boolean; e?: number };

function signKit(body: string) {
  return createHmac("sha256", secret()).update(`admission-kit:${body}`).digest("base64url");
}

export function admissionKitToken(studentId: string, orgId: string | null, fileIds: string[], withConfirmation = true) {
  const claims: KitClaims = { s: studentId, o: orgId, f: fileIds.slice(0, 20), c: withConfirmation };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${signKit(body)}`;
}

function readKitToken(token: string): KitClaims | null {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(signKit(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as KitClaims;
    if (!claims.s || (claims.e && claims.e < Date.now())) return null;
    return { ...claims, f: Array.isArray(claims.f) ? claims.f.map(String) : [] };
  } catch {
    return null;
  }
}

export async function admissionKitLinkCore(user: AccessUser, input: { studentId?: string; fileIds?: string[]; confirmation?: boolean }) {
  const studentId = String(input.studentId || "").trim();
  if (!studentId) throw new Error("Choose a student.");
  await assertStudentAccess(user, studentId, [CLASS_STUDENTS_ADD, CLASS_STUDENTS_EDIT]);
  const fileIds = (Array.isArray(input.fileIds) ? input.fileIds : []).map(String).filter(Boolean);
  return { url: `${publicOrigin()}/kit/${admissionKitToken(studentId, user.orgId ?? null, fileIds, input.confirmation !== false)}` };
}

function esc(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const PDF_EXT = /\.pdf$/i;

const KIT_STYLE = `<style>.kit-page{display:flex;flex-direction:column;padding:12mm;box-sizing:border-box}.kit-cap{display:flex;justify-content:space-between;gap:8px;font:600 11px Inter,system-ui,sans-serif;color:#475569;padding-bottom:3mm;margin-bottom:4mm;border-bottom:1px solid #E2E8F0}.kit-cap b{color:#0F172A}.kit-body{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}.kit-body img,.kit-body canvas{max-width:100%;max-height:100%;object-fit:contain}.kit-note{font:500 12px Inter,system-ui,sans-serif;color:#64748B;text-align:center}.kit-note a{color:#2563EB}@media print{.page-wrap{break-after:page}.page-wrap:last-of-type{break-after:auto}}</style>`;

/** Fits every page to a phone screen (the single-document script only fits the first). */
const KIT_FIT_SCRIPT = `<script>(function(){function fit(){var room=document.documentElement.clientWidth-16;document.querySelectorAll(".page").forEach(function(p){var w=p.parentElement;p.style.transform="";w.style.height="";var s=Math.min(1,room/p.offsetWidth);if(s<1){p.style.transform="scale("+s+")";p.style.transformOrigin="top left";w.style.display="block";w.style.padding="8px";w.style.overflow="hidden";w.style.height=Math.ceil(p.offsetHeight*s+16)+"px";p.style.marginBottom="0"}else{w.style.display="";w.style.padding="";w.style.overflow=""}})}window.__kitFit=fit;addEventListener("resize",fit);addEventListener("load",fit);fit()})()</script>`;

/** Renders PDF uploads page by page (pdf.js), each on its own A4 page, so Download PDF saves one file. */
const KIT_PDF_SCRIPT = `<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script><script>(function(){var lib=window.pdfjsLib;var slots=document.querySelectorAll("[data-pdf]");if(!slots.length)return;if(!lib){slots.forEach(function(s){s.querySelector(".kit-note").textContent="Open the attached PDF from the link above."});return}lib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";slots.forEach(function(slot){var url=slot.getAttribute("data-pdf");lib.getDocument(url).promise.then(function(doc){var chain=Promise.resolve(),after=slot;for(var i=1;i<=doc.numPages;i++)(function(n){chain=chain.then(function(){return doc.getPage(n).then(function(page){var vp=page.getViewport({scale:2});var c=document.createElement("canvas");c.width=vp.width;c.height=vp.height;return page.render({canvasContext:c.getContext("2d"),viewport:vp}).promise.then(function(){var wrap=n===1?slot:slot.cloneNode(true);var body=wrap.querySelector(".kit-body");body.innerHTML="";body.appendChild(c);if(n>1){var cap=wrap.querySelector(".kit-cap span");if(cap)cap.textContent="Page "+n+" of "+doc.numPages;after.parentNode.insertBefore(wrap,after.nextSibling)}after=wrap})})})})(i);return chain}).then(function(){window.__kitFit&&window.__kitFit()}).catch(function(){slot.querySelector(".kit-note").innerHTML='Could not show this PDF here. <a href="'+url+'">Open it</a>.'})})})()</script>`;

function kitPage(cap: string, right: string, body: string, pdfUrl = "") {
  return `<div class="page-wrap"${pdfUrl ? ` data-pdf="${esc(pdfUrl)}"` : ""}><main class="page kit-page"><div class="kit-cap"><b>${esc(cap)}</b><span>${esc(right)}</span></div><div class="kit-body">${body}</div></main></div>`;
}

function kitShell(title: string, pages: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&display=swap" rel="stylesheet"><style>@page{size:210mm 297mm;margin:0}body{margin:0;background:#e8edf2;font-family:Inter,system-ui,sans-serif}.toolbar{position:sticky;top:0;z-index:2;padding:12px;text-align:center;background:#eef2f7}.toolbar button{font:600 14px Inter,system-ui,sans-serif;padding:10px 20px;border:0;border-radius:999px;background:#1E2A44;color:#fff;cursor:pointer}.page-wrap{display:flex;justify-content:center;padding:24px}.page{position:relative;flex-shrink:0;width:210mm;height:297mm;background:#fff;box-shadow:0 2px 18px #102a4322;overflow:hidden}@media print{body{background:#fff}.toolbar{display:none}.page-wrap{display:block!important;padding:0!important}.page{box-shadow:none;transform:none!important}}</style></head><body><div class="toolbar"><button onclick="window.print()">Download PDF</button></div>${pages}</body></html>`;
}

/** The whole admission pack as one printable page set, or null when the link is bad or expired. */
export async function admissionKitHtml(token: string): Promise<string | null> {
  const claims = readKitToken(token);
  if (!claims) return null;
  return runWithoutTenant(async () => {
    setTenantOrg(claims.o);
    const student = await prisma.student.findFirst({ where: { id: claims.s }, select: { id: true, name: true, admissionNo: true, photoPath: true, leftOn: true, ...FIELD_VALUES_INCLUDE } });
    // The pack stays open while the student is at the school; it closes once they leave.
    if (!student || student.leftOn) return null;
    const files = (await admissionFilesFor(student)).filter((file) => file.path && claims.f.includes(file.id));
    const pages = files
      .map((file) => {
        const url = `/files/s/${signedFileToken(file.path, `${file.label}${fileExtension(file.path)}`)}`;
        const right = `${student.name} · ${student.admissionNo}`;
        if (IMAGE_EXT.test(file.path)) return kitPage(file.label, right, `<img src="${esc(url)}" alt="${esc(file.label)}">`);
        if (PDF_EXT.test(file.path)) return kitPage(file.label, right, `<div class="kit-note">Loading PDF… <a href="${esc(url)}">Open</a></div>`, url);
        return kitPage(file.label, right, `<div class="kit-note">This file can't be shown here. <a href="${esc(url)}">Open ${esc(file.label)}</a></div>`);
      })
      .join("");
    const confirmation = claims.c === false ? null : await prisma.issuedDocument.findFirst({
      where: { type: "ADMISSION_CONFIRMATION", status: "VALID", subjectType: "STUDENT", subjectId: student.id },
      orderBy: { issuedAt: "desc" },
      select: { renderedHtml: true },
    });
    const title = `Admission documents · ${student.name}`;
    let html = confirmation?.renderedHtml || "";
    const cut = html.indexOf("</main></div>");
    if (!html || cut < 0) return kitShell(title, pages).replace("</body>", `${KIT_STYLE}${KIT_FIT_SCRIPT}${KIT_PDF_SCRIPT}</body>`);
    html = html.slice(0, cut + "</main></div>".length) + pages + html.slice(cut + "</main></div>".length);
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`).replace("</head>", `${KIT_STYLE}</head>`);
    return html.replace("</body>", `${KIT_FIT_SCRIPT}${KIT_PDF_SCRIPT}</body>`);
  });
}
