import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { googleAdminAuthConfigured, type SaasAdminSession } from "./saas-admin-auth";

type UnknownRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function integer(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function optionalDate(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Enter a valid date.");
  return date;
}

function requiredDate(value: unknown, label: string) {
  const date = optionalDate(value);
  if (!date) throw new Error(`${label} is required.`);
  return date;
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function dateLabel(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function dateInput(value: Date | string | null | undefined) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function statusTone(status: string) {
  if (["ACTIVE", "PAID", "ISSUED"].includes(status)) return "positive";
  if (["OVERDUE", "FAILED", "CANCELLED", "VOID"].includes(status)) return "danger";
  if (["TRIAL", "PARTIALLY_PAID", "PAUSED"].includes(status)) return "warning";
  return "neutral";
}

async function audit(actorEmail: string, action: string, input: { orgId?: string; entityType?: string; entityId?: string; detail?: string }) {
  return prisma.saasAuditEvent.create({
    data: {
      actorEmail,
      action,
      orgId: input.orgId || null,
      entityType: input.entityType || "",
      entityId: input.entityId || "",
      detail: input.detail || "",
    },
  });
}

export async function createAdminOrganisation(input: UnknownRecord, actorEmail: string) {
  const schoolName = text(input.schoolName);
  const ownerName = text(input.ownerName);
  const ownerEmail = text(input.ownerEmail).toLowerCase();
  const ownerPhone = text(input.ownerPhone);
  if (!schoolName || !ownerName || !ownerEmail || !ownerPhone) {
    throw new Error("Organisation, contact name, email, and phone are required.");
  }
  const duplicate = await prisma.saasOrg.findFirst({
    where: { OR: [{ schoolName }, { ownerEmail }, { ownerPhone }] },
  });
  if (duplicate) throw new Error(`A possible duplicate already exists: ${duplicate.schoolName}.`);
  const org = await prisma.saasOrg.create({
    data: {
      schoolName,
      ownerName,
      ownerEmail,
      ownerPhone,
      city: text(input.city),
      teacherCount: text(input.teacherCount) ? integer(input.teacherCount) : null,
      studentCount: text(input.studentCount) ? integer(input.studentCount) : null,
      subscriptionStatus: text(input.subscriptionStatus, "LEAD").toUpperCase(),
      plan: text(input.plan, "Monthly school"),
      monthlyPrice: integer(input.monthlyPrice, 14999),
      assignedOwner: text(input.assignedOwner),
      followUpStatus: text(input.followUpStatus, "NEW").toUpperCase(),
      nextFollowUpOn: optionalDate(input.nextFollowUpOn),
      billingAddress: text(input.billingAddress),
      billingState: text(input.billingState),
      billingPincode: text(input.billingPincode),
      gstin: text(input.gstin).toUpperCase(),
      notes: text(input.notes),
      subscriptionStart: optionalDate(input.subscriptionStart),
      renewalOn: optionalDate(input.renewalOn),
    },
  });
  await audit(actorEmail, "ORGANISATION_CREATED", { orgId: org.id, entityType: "ORGANISATION", entityId: org.id, detail: org.schoolName });
  return org;
}

export async function updateAdminOrganisation(id: string, input: UnknownRecord, actorEmail: string) {
  const existing = await prisma.saasOrg.findUnique({ where: { id } });
  if (!existing) throw new Error("Organisation not found.");
  const schoolName = text(input.schoolName);
  const ownerName = text(input.ownerName);
  const ownerEmail = text(input.ownerEmail).toLowerCase();
  const ownerPhone = text(input.ownerPhone);
  if (!schoolName || !ownerName || !ownerEmail || !ownerPhone) {
    throw new Error("Organisation, contact name, email, and phone are required.");
  }
  const org = await prisma.saasOrg.update({
    where: { id },
    data: {
      schoolName,
      ownerName,
      ownerEmail,
      ownerPhone,
      city: text(input.city),
      teacherCount: text(input.teacherCount) ? integer(input.teacherCount) : null,
      studentCount: text(input.studentCount) ? integer(input.studentCount) : null,
      subscriptionStatus: text(input.subscriptionStatus, existing.subscriptionStatus).toUpperCase(),
      plan: text(input.plan, existing.plan),
      monthlyPrice: integer(input.monthlyPrice, existing.monthlyPrice),
      assignedOwner: text(input.assignedOwner),
      followUpStatus: text(input.followUpStatus, existing.followUpStatus).toUpperCase(),
      nextFollowUpOn: optionalDate(input.nextFollowUpOn),
      billingAddress: text(input.billingAddress),
      billingState: text(input.billingState),
      billingPincode: text(input.billingPincode),
      gstin: text(input.gstin).toUpperCase(),
      notes: text(input.notes),
      loginUrl: text(input.loginUrl),
      apiUrl: text(input.apiUrl),
      subscriptionStart: optionalDate(input.subscriptionStart),
      renewalOn: optionalDate(input.renewalOn),
    },
  });
  await audit(actorEmail, "ORGANISATION_UPDATED", { orgId: id, entityType: "ORGANISATION", entityId: id, detail: org.schoolName });
  return org;
}

export async function createAdminInvoice(orgId: string, input: UnknownRecord, actorEmail: string) {
  const org = await prisma.saasOrg.findUnique({ where: { id: orgId } });
  if (!org) throw new Error("Organisation not found.");
  const description = text(input.description);
  const quantity = Math.max(1, integer(input.quantity, 1));
  const unitPrice = integer(input.unitPrice);
  const taxPercent = Math.min(100, integer(input.taxPercent));
  if (!description || !unitPrice) throw new Error("Invoice description and unit price are required.");
  const issueDate = requiredDate(input.issueDate, "Invoice date");
  const dueDate = requiredDate(input.dueDate, "Due date");
  if (dueDate < issueDate) throw new Error("Due date cannot be before the invoice date.");
  const subtotal = quantity * unitPrice;
  const taxAmount = Math.round((subtotal * taxPercent) / 100);
  const invoice = await prisma.saasInvoice.create({
    data: {
      orgId,
      number: `DRAFT-${Date.now()}-${randomBytes(3).toString("hex")}`,
      issueDate,
      dueDate,
      description,
      quantity,
      unitPrice,
      taxPercent,
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
      notes: text(input.notes),
    },
  });
  await audit(actorEmail, "INVOICE_DRAFT_CREATED", { orgId, entityType: "INVOICE", entityId: invoice.id, detail: money(invoice.total) });
  return invoice;
}

function invoiceNumber(sequence: number, date = new Date()) {
  const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(date);
  return `ANE-${year}-${String(sequence).padStart(4, "0")}`;
}

export async function issueAdminInvoice(id: string, actorEmail: string) {
  const invoice = await prisma.saasInvoice.findUnique({ where: { id } });
  if (!invoice) throw new Error("Invoice not found.");
  if (invoice.status !== "DRAFT") throw new Error("Only a draft invoice can be issued.");
  const issuedCount = await prisma.saasInvoice.count({ where: { status: { not: "DRAFT" } } });
  const issued = await prisma.saasInvoice.update({
    where: { id },
    data: { number: invoiceNumber(issuedCount + 1), status: "ISSUED", issuedAt: new Date() },
  });
  await audit(actorEmail, "INVOICE_ISSUED", { orgId: issued.orgId, entityType: "INVOICE", entityId: id, detail: issued.number });
  return issued;
}

export async function recordAdminPayment(invoiceId: string, input: UnknownRecord, actorEmail: string) {
  const invoice = await prisma.saasInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new Error("Invoice not found.");
  if (["DRAFT", "VOID", "PAID"].includes(invoice.status)) throw new Error("This invoice cannot accept a payment.");
  const amount = integer(input.amount);
  const outstanding = Math.max(0, invoice.total - invoice.paidAmount);
  if (!amount) throw new Error("Payment amount must be greater than zero.");
  if (amount > outstanding) throw new Error(`Payment cannot exceed the outstanding amount of ${money(outstanding)}.`);
  const reference = text(input.reference);
  if (reference) {
    const duplicate = await prisma.saasPayment.findFirst({ where: { paymentId: reference } });
    if (duplicate) throw new Error("A payment with this reference already exists.");
  }
  const nextPaid = invoice.paidAmount + amount;
  const status = nextPaid >= invoice.total ? "PAID" : "PARTIALLY_PAID";
  const paidAt = requiredDate(input.paidAt, "Payment date");
  return prisma.$transaction(async (tx) => {
    const payment = await tx.saasPayment.create({
      data: {
        orgId: invoice.orgId,
        invoiceId,
        amount,
        provider: text(input.method, "BANK_TRANSFER").toUpperCase(),
        paymentId: reference || null,
        status: "PAID",
        notes: text(input.notes),
        paidAt,
      },
    });
    await tx.saasInvoice.update({ where: { id: invoiceId }, data: { paidAmount: nextPaid, status } });
    await tx.saasOrg.update({
      where: { id: invoice.orgId },
      data: { paymentStatus: status === "PAID" ? "PAID" : "PARTIAL", subscriptionStatus: status === "PAID" ? "ACTIVE" : undefined },
    });
    await tx.saasAuditEvent.create({
      data: { orgId: invoice.orgId, actorEmail, action: "PAYMENT_RECORDED", entityType: "PAYMENT", entityId: payment.id, detail: `${money(amount)} · ${reference || payment.provider}` },
    });
    return payment;
  });
}

function baseUrl(basePath: string, params: Record<string, string> = {}) {
  const url = new URL(basePath || "/", "http://admin.local");
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

function badge(status: string) {
  return `<span class="badge ${statusTone(status)}">${escapeHtml(status.replaceAll("_", " "))}</span>`;
}

function csrfField(session: SaasAdminSession) {
  return `<input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">`;
}

function icon(name: string) {
  const icons: Record<string, string> = { dashboard: "⌂", organisations: "▦", invoices: "▤", payments: "₹", followups: "◷", settings: "⚙" };
  return icons[name] || "•";
}

function adminDocument(input: { title: string; basePath: string; session: SaasAdminSession; view: string; body: string; flash?: string; error?: string }) {
  const nav = [
    ["dashboard", "Dashboard"], ["organisations", "Organisations"], ["invoices", "Invoices"], ["payments", "Payments"], ["followups", "Follow-ups"], ["settings", "Settings"],
  ];
  const link = (view: string) => baseUrl(input.basePath, view === "dashboard" ? {} : { view });
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(input.title)} · Anekio Admin</title><style>
  :root{--bg:#f5f7fb;--panel:#fff;--ink:#172033;--muted:#697386;--line:#e5e9f0;--brand:#4f46e5;--brand2:#7c3aed;--green:#067647;--greenbg:#ecfdf3;--amber:#b54708;--amberbg:#fffaeb;--red:#b42318;--redbg:#fef3f2;--nav:#111827;--shadow:0 12px 30px rgba(17,24,39,.06)}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px}a{color:inherit;text-decoration:none}button,input,select,textarea{font:inherit}.layout{min-height:100vh;display:grid;grid-template-columns:248px 1fr}.sidebar{position:sticky;top:0;height:100vh;background:var(--nav);color:#d1d5db;padding:24px 16px;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:11px;color:#fff;font-size:18px;font-weight:800;padding:0 10px 24px}.mark{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:linear-gradient(135deg,var(--brand),var(--brand2));font-weight:900}.nav{display:grid;gap:5px}.nav a{display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:9px;font-weight:650}.nav a:hover,.nav a.active{background:#293244;color:#fff}.nav-icon{width:20px;text-align:center}.user{margin-top:auto;padding:14px 10px 0;border-top:1px solid #2d3748}.user b{display:block;color:#fff;font-size:13px}.user span{display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis}.user a{display:inline-block;margin-top:10px;color:#c7d2fe;font-weight:700}.main{min-width:0}.topbar{height:66px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 32px;position:sticky;top:0;z-index:5}.topbar .mobile-brand{display:none;font-weight:800}.search{width:min(420px,50vw);position:relative}.search input{width:100%;background:#f8fafc;border:1px solid var(--line);border-radius:9px;padding:10px 12px}.content{width:min(1320px,100%);padding:30px 32px 60px}.page-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:24px}.page-head h1{margin:0;font-size:28px;letter-spacing:-.025em}.page-head p{margin:7px 0 0;color:var(--muted)}.btn{border:1px solid #d0d5dd;background:#fff;border-radius:9px;padding:10px 14px;font-weight:750;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px}.btn:hover{background:#f8fafc}.btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}.btn.danger{color:var(--red)}.grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.metric,.panel{background:var(--panel);border:1px solid var(--line);border-radius:13px;box-shadow:var(--shadow)}.metric{padding:18px}.metric span{display:block;color:var(--muted);font-size:12px;font-weight:700}.metric strong{display:block;font-size:26px;margin-top:8px;letter-spacing:-.03em}.panel{margin-top:18px;overflow:hidden}.panel-head{padding:17px 19px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}.panel-head h2{margin:0;font-size:16px}.panel-body{padding:19px}.split{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,.7fr);gap:18px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th{padding:11px 14px;text-align:left;color:var(--muted);background:#f9fafb;font-size:11px;text-transform:uppercase;letter-spacing:.05em}td{padding:14px;border-top:1px solid var(--line);vertical-align:middle}tbody tr:hover{background:#fafbff}.num{text-align:right;font-variant-numeric:tabular-nums}.muted{color:var(--muted)}.small{font-size:12px}.badge{display:inline-flex;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:800;background:#f2f4f7;color:#475467}.badge.positive{color:var(--green);background:var(--greenbg)}.badge.warning{color:var(--amber);background:var(--amberbg)}.badge.danger{color:var(--red);background:var(--redbg)}.flash{border-radius:10px;padding:12px 14px;margin-bottom:18px;font-weight:650}.flash.ok{background:var(--greenbg);color:var(--green);border:1px solid #abefc6}.flash.error{background:var(--redbg);color:var(--red);border:1px solid #fecdca}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.field{display:grid;gap:6px}.field.full{grid-column:1/-1}.field label{font-size:12px;font-weight:750;color:#344054}.field input,.field select,.field textarea{width:100%;border:1px solid #d0d5dd;border-radius:9px;background:#fff;padding:10px 11px;color:var(--ink);outline:none}.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--brand);box-shadow:0 0 0 3px #e0e7ff}.field textarea{min-height:92px;resize:vertical}.form-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.detail-head{background:linear-gradient(135deg,#fff,#f7f7ff);border:1px solid var(--line);border-radius:14px;padding:22px;display:flex;justify-content:space-between;gap:18px}.detail-head h1{margin:4px 0 8px}.detail-stats{display:flex;gap:24px;align-items:center}.detail-stats span{display:block;color:var(--muted);font-size:11px}.detail-stats strong{font-size:18px}.empty{padding:40px 20px;text-align:center;color:var(--muted)}.empty strong{display:block;color:var(--ink);font-size:16px;margin-bottom:6px}.actions{display:flex;gap:8px;flex-wrap:wrap}.stack{display:grid;gap:10px}.activity{padding:0;margin:0;list-style:none}.activity li{padding:12px 0;border-bottom:1px solid var(--line)}.activity li:last-child{border:0}.mobile-nav{display:none}.print-only{display:none}@media(max-width:980px){.grid4{grid-template-columns:repeat(2,1fr)}.split{grid-template-columns:1fr}.layout{grid-template-columns:210px 1fr}.content{padding:24px 20px}.topbar{padding:0 20px}}@media(max-width:720px){.layout{display:block}.sidebar{display:none}.topbar{height:58px;padding:0 16px}.topbar .mobile-brand{display:block}.search{width:62%}.content{padding:20px 14px 82px}.grid4{grid-template-columns:1fr 1fr;gap:10px}.metric{padding:14px}.metric strong{font-size:21px}.page-head,.detail-head{display:grid}.page-head h1{font-size:24px}.detail-stats{display:grid;grid-template-columns:repeat(2,1fr)}.form-grid{grid-template-columns:1fr}.field.full{grid-column:auto}.panel{border-radius:11px}.mobile-nav{display:grid;grid-template-columns:repeat(5,1fr);position:fixed;z-index:9;bottom:0;left:0;right:0;background:#fff;border-top:1px solid var(--line);padding:7px 4px env(safe-area-inset-bottom)}.mobile-nav a{font-size:10px;text-align:center;color:var(--muted)}.mobile-nav span{display:block;font-size:18px;color:var(--ink)}th:nth-child(3),td:nth-child(3){display:none}}@media(max-width:430px){.grid4{grid-template-columns:1fr}.search{width:58%}.table-wrap{margin:0 -19px}th,td{padding:12px 10px}}
  </style></head><body><div class="layout"><aside class="sidebar"><div class="brand"><span class="mark">A</span><span>Anekio Admin</span></div><nav class="nav">${nav.map(([key,label])=>`<a class="${input.view===key?"active":""}" href="${link(key)}"><span class="nav-icon">${icon(key)}</span>${label}</a>`).join("")}</nav><div class="user"><b>Internal operator</b><span>${escapeHtml(input.session.email)}</span><a href="${input.basePath}/logout">Sign out</a></div></aside><main class="main"><header class="topbar"><span class="mobile-brand">Anekio</span><form class="search" method="get" action="${input.basePath || "/"}"><input type="hidden" name="view" value="organisations"><input name="q" placeholder="Search organisations…" aria-label="Search organisations"></form><span class="muted small">Internal · secure</span></header><div class="content">${input.flash?`<div class="flash ok">${escapeHtml(input.flash)}</div>`:""}${input.error?`<div class="flash error">${escapeHtml(input.error)}</div>`:""}${input.body}</div></main></div><nav class="mobile-nav">${nav.slice(0,5).map(([key,label])=>`<a href="${link(key)}"><span>${icon(key)}</span>${label}</a>`).join("")}</nav></body></html>`;
}

function pageHead(title: string, description: string, action = "") {
  return `<div class="page-head"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${action}</div>`;
}

function empty(title: string, body: string, action = "") {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p>${action}</div>`;
}

function orgForm(basePath: string, session: SaasAdminSession, org?: any) {
  const action = org ? `${basePath}/orgs/${encodeURIComponent(org.id)}` : `${basePath}/orgs`;
  const value = (key: string) => escapeHtml(org?.[key] ?? "");
  const selected = (key: string, option: string) => String(org?.[key] || (key === "subscriptionStatus" ? "LEAD" : "NEW")) === option ? " selected" : "";
  return `<form method="post" action="${action}">${csrfField(session)}<div class="form-grid"><div class="field"><label>Organisation / school name *</label><input name="schoolName" required value="${value("schoolName")}"></div><div class="field"><label>City</label><input name="city" value="${value("city")}"></div><div class="field"><label>Primary contact *</label><input name="ownerName" required value="${value("ownerName")}"></div><div class="field"><label>Phone *</label><input name="ownerPhone" required inputmode="tel" value="${value("ownerPhone")}"></div><div class="field"><label>Email *</label><input name="ownerEmail" required type="email" value="${value("ownerEmail")}"></div><div class="field"><label>Internal owner</label><input name="assignedOwner" value="${value("assignedOwner")}" placeholder="Who manages this account?"></div><div class="field"><label>Lifecycle</label><select name="subscriptionStatus">${["LEAD","TRIAL","ACTIVE","PAUSED","CANCELLED","CLOSED"].map(x=>`<option${selected("subscriptionStatus",x)}>${x}</option>`).join("")}</select></div><div class="field"><label>Plan</label><input name="plan" value="${value("plan")}" placeholder="Monthly school"></div><div class="field"><label>Plan amount (₹)</label><input name="monthlyPrice" type="number" min="0" value="${value("monthlyPrice") || "14999"}"></div><div class="field"><label>Renewal date</label><input name="renewalOn" type="date" value="${dateInput(org?.renewalOn)}"></div><div class="field"><label>Follow-up status</label><select name="followUpStatus">${["NEW","CONTACTED","DEMO_SCHEDULED","PROPOSAL_SENT","FOLLOW_UP","WON","LOST"].map(x=>`<option${selected("followUpStatus",x)}>${x.replaceAll("_"," ")}</option>`).join("")}</select></div><div class="field"><label>Next follow-up</label><input name="nextFollowUpOn" type="date" value="${dateInput(org?.nextFollowUpOn)}"></div><div class="field"><label>GSTIN</label><input name="gstin" maxlength="15" value="${value("gstin")}"></div><div class="field"><label>Billing state</label><input name="billingState" value="${value("billingState")}"></div><div class="field full"><label>Billing address</label><textarea name="billingAddress">${value("billingAddress")}</textarea></div><div class="field full"><label>Internal notes</label><textarea name="notes">${value("notes")}</textarea></div></div><div class="form-actions"><a class="btn" href="${baseUrl(basePath,{view:"organisations"})}">Cancel</a><button class="btn primary" type="submit">${org?"Save changes":"Add organisation"}</button></div></form>`;
}

export function adminLoginHtml(basePath: string, error = "") {
  const configured = googleAdminAuthConfigured();
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Sign in · Anekio Admin</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top left,#ede9fe,transparent 38%),#f7f8fc;color:#182033;font-family:Inter,system-ui,sans-serif}.card{width:min(430px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:32px;box-shadow:0 24px 60px rgba(17,24,39,.12)}.mark{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-size:22px;font-weight:900}h1{font-size:27px;margin:22px 0 8px}p{color:#667085;line-height:1.6}.btn{width:100%;display:flex;align-items:center;justify-content:center;border-radius:10px;padding:12px 16px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:800;margin-top:22px}.note,.error{border-radius:10px;padding:12px;margin-top:16px;font-size:13px}.note{background:#f2f4f7;color:#475467}.error{background:#fef3f2;color:#b42318}.fine{font-size:12px;margin-top:18px}</style></head><body><main class="card"><div class="mark">A</div><h1>Sign in to Anekio Admin</h1><p>Manage organisations, subscriptions, invoices, payments, and follow-ups.</p>${error?`<div class="error">${escapeHtml(error)}</div>`:""}${configured?`<a class="btn" href="${basePath}/auth/google">Continue with Google</a>`:`<div class="note"><strong>Google sign-in needs configuration.</strong><br>Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then register this portal's callback URL in Google Cloud.</div>`}<p class="fine">Access is limited to buildtogether.tech@gmail.com and verified @anekio.com / @anekio.in accounts.</p></main></body></html>`;
}

export async function adminPortalHtml(input: { basePath: string; session: SaasAdminSession; view?: string; id?: string; q?: string; flash?: string; error?: string }) {
  const view = input.view || "dashboard";
  const orgs = await prisma.saasOrg.findMany({
    where: input.q ? { OR: [{ schoolName: { contains: input.q } }, { ownerName: { contains: input.q } }, { ownerEmail: { contains: input.q } }, { ownerPhone: { contains: input.q } }] } : undefined,
    orderBy: { updatedAt: "desc" },
    include: { invoices: { orderBy: { createdAt: "desc" } }, payments: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
  const allInvoices = await prisma.saasInvoice.findMany({ orderBy: { createdAt: "desc" }, include: { org: true }, take: 100 });
  const outstanding = allInvoices.filter(i=>!["DRAFT","VOID"].includes(i.status)).reduce((sum,i)=>sum+Math.max(0,i.total-i.paidAmount),0);
  const overdue = allInvoices.filter(i=>!["DRAFT","PAID","VOID"].includes(i.status) && i.dueDate < new Date());
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
  const monthPayments = await prisma.saasPayment.aggregate({ where: { status: "PAID", paidAt: { gte: monthStart } }, _sum: { amount: true } });
  let body = "";
  if (view === "dashboard") {
    const dueFollowups = orgs.filter(o=>o.nextFollowUpOn && o.nextFollowUpOn <= new Date()).slice(0,6);
    const attention = orgs.filter(o=>o.subscriptionStatus!=="ACTIVE" || o.invoices.some(i=>!["DRAFT","PAID","VOID"].includes(i.status))).slice(0,7);
    const events = await prisma.saasAuditEvent.findMany({ orderBy:{createdAt:"desc"},take:8,include:{org:true} });
    body = `${pageHead("Dashboard","A clear view of customers, money, and next actions.",`<a class="btn primary" href="${baseUrl(input.basePath,{view:"new-org"})}">＋ Add organisation</a>`)}<section class="grid4"><div class="metric"><span>Active organisations</span><strong>${orgs.filter(o=>o.subscriptionStatus==="ACTIVE").length}</strong></div><div class="metric"><span>Outstanding</span><strong>${money(outstanding)}</strong></div><div class="metric"><span>Overdue invoices</span><strong>${overdue.length}</strong></div><div class="metric"><span>Payments this month</span><strong>${money(monthPayments._sum.amount||0)}</strong></div></section><div class="split"><section class="panel"><div class="panel-head"><h2>Needs attention</h2><a class="small muted" href="${baseUrl(input.basePath,{view:"organisations"})}">View all →</a></div>${attention.length?`<div class="table-wrap"><table><thead><tr><th>Organisation</th><th>Status</th><th>Outstanding</th><th>Next action</th></tr></thead><tbody>${attention.map(o=>`<tr><td><a href="${baseUrl(input.basePath,{view:"org",id:o.id})}"><strong>${escapeHtml(o.schoolName)}</strong><div class="muted small">${escapeHtml(o.ownerName)}</div></a></td><td>${badge(o.subscriptionStatus)}</td><td class="num">${money(o.invoices.reduce((s,i)=>s+Math.max(0,i.total-i.paidAmount),0))}</td><td>${escapeHtml(o.followUpStatus.replaceAll("_"," "))}<div class="muted small">${dateLabel(o.nextFollowUpOn)}</div></td></tr>`).join("")}</tbody></table></div>`:empty("Everything is clear","No organisations need attention right now.")}</section><div><section class="panel"><div class="panel-head"><h2>Follow-ups due</h2></div>${dueFollowups.length?`<div class="panel-body stack">${dueFollowups.map(o=>`<a href="${baseUrl(input.basePath,{view:"org",id:o.id})}"><strong>${escapeHtml(o.schoolName)}</strong><div class="muted small">${escapeHtml(o.followUpStatus)} · ${dateLabel(o.nextFollowUpOn)}</div></a>`).join("")}</div>`:empty("Nothing due","Your follow-up queue is clear.")}</section><section class="panel"><div class="panel-head"><h2>Recent activity</h2></div><div class="panel-body"><ul class="activity">${events.map(e=>`<li><strong>${escapeHtml(e.action.replaceAll("_"," "))}</strong><div class="muted small">${escapeHtml(e.org?.schoolName||e.detail)} · ${dateLabel(e.createdAt)}</div></li>`).join("")||"<li class=muted>No activity yet.</li>"}</ul></div></section></div></div>`;
  } else if (view === "organisations") {
    body = `${pageHead("Organisations",input.q?`Search results for “${input.q}”`:"Manage customer ownership, subscription health, and follow-ups.",`<a class="btn primary" href="${baseUrl(input.basePath,{view:"new-org"})}">＋ Add organisation</a>`)}<section class="panel"><div class="table-wrap">${orgs.length?`<table><thead><tr><th>Organisation</th><th>Primary contact</th><th>Status</th><th>Plan</th><th>Outstanding</th><th>Follow-up</th></tr></thead><tbody>${orgs.map(o=>`<tr><td><a href="${baseUrl(input.basePath,{view:"org",id:o.id})}"><strong>${escapeHtml(o.schoolName)}</strong><div class="muted small">${escapeHtml(o.city||"City not added")}</div></a></td><td>${escapeHtml(o.ownerName)}<div class="muted small">${escapeHtml(o.ownerEmail)}</div></td><td>${badge(o.subscriptionStatus)}</td><td>${escapeHtml(o.plan)}<div class="muted small">${money(o.monthlyPrice)}</div></td><td class="num">${money(o.invoices.reduce((s,i)=>s+Math.max(0,i.total-i.paidAmount),0))}</td><td>${escapeHtml(o.followUpStatus.replaceAll("_"," "))}<div class="muted small">${dateLabel(o.nextFollowUpOn)}</div></td></tr>`).join("")}</tbody></table>`:empty("No organisations yet","Add the first customer organisation to begin.",`<a class="btn primary" href="${baseUrl(input.basePath,{view:"new-org"})}">Add organisation</a>`)}</div></section>`;
  } else if (view === "new-org") {
    body = `${pageHead("Add organisation","Start with the essentials; commercial and billing details can be completed now or later.")}<section class="panel"><div class="panel-body">${orgForm(input.basePath,input.session)}</div></section>`;
  } else if (view === "org" || view === "edit-org") {
    const org = await prisma.saasOrg.findUnique({ where:{id:input.id||""},include:{invoices:{orderBy:{createdAt:"desc"}},payments:{orderBy:{createdAt:"desc"}},auditEvents:{orderBy:{createdAt:"desc"},take:30}} });
    if (!org) body = pageHead("Organisation not found","The requested organisation is unavailable.");
    else if (view === "edit-org") body = `${pageHead(`Edit ${org.schoolName}`,"Update contact, commercial, billing, and follow-up information.")}<section class="panel"><div class="panel-body">${orgForm(input.basePath,input.session,org)}</div></section>`;
    else {
      const balance = org.invoices.reduce((s,i)=>s+Math.max(0,i.total-i.paidAmount),0);
      body = `<section class="detail-head"><div><div class="muted small">ORGANISATION</div><h1>${escapeHtml(org.schoolName)}</h1><div class="actions">${badge(org.subscriptionStatus)} ${badge(org.paymentStatus)}</div></div><div class="detail-stats"><div><span>Plan</span><strong>${escapeHtml(org.plan)}</strong></div><div><span>Outstanding</span><strong>${money(balance)}</strong></div><div><span>Renewal</span><strong>${dateLabel(org.renewalOn)}</strong></div></div><div class="actions"><a class="btn" href="${baseUrl(input.basePath,{view:"edit-org",id:org.id})}">Edit</a><a class="btn primary" href="${baseUrl(input.basePath,{view:"new-invoice",id:org.id})}">Create invoice</a></div></section><div class="split"><div><section class="panel"><div class="panel-head"><h2>Overview</h2></div><div class="panel-body form-grid"><div><strong>${escapeHtml(org.ownerName)}</strong><div class="muted">${escapeHtml(org.ownerEmail)} · ${escapeHtml(org.ownerPhone)}</div></div><div><strong>Internal owner</strong><div class="muted">${escapeHtml(org.assignedOwner||"Not assigned")}</div></div><div><strong>Billing</strong><div class="muted">${escapeHtml([org.billingAddress,org.billingState,org.billingPincode].filter(Boolean).join(", ")||"Not completed")}</div></div><div><strong>Next follow-up</strong><div class="muted">${escapeHtml(org.followUpStatus.replaceAll("_"," "))} · ${dateLabel(org.nextFollowUpOn)}</div></div>${org.notes?`<div class="field full"><strong>Internal notes</strong><div class="muted">${escapeHtml(org.notes)}</div></div>`:""}</div></section><section class="panel"><div class="panel-head"><h2>Invoices</h2><a class="btn" href="${baseUrl(input.basePath,{view:"new-invoice",id:org.id})}">＋ New invoice</a></div>${org.invoices.length?`<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th>Total</th><th>Balance</th></tr></thead><tbody>${org.invoices.map(i=>`<tr><td><a href="${baseUrl(input.basePath,{view:"invoice",id:i.id})}"><strong>${escapeHtml(i.number)}</strong><div class="muted small">${escapeHtml(i.description)}</div></a></td><td>${dateLabel(i.issueDate)}</td><td>${badge(i.status)}</td><td class="num">${money(i.total)}</td><td class="num">${money(i.total-i.paidAmount)}</td></tr>`).join("")}</tbody></table></div>`:empty("No invoices","Create a draft invoice when commercial terms are ready.")}</section></div><section class="panel"><div class="panel-head"><h2>Activity</h2></div><div class="panel-body"><ul class="activity">${org.auditEvents.map(e=>`<li><strong>${escapeHtml(e.action.replaceAll("_"," "))}</strong><div class="muted small">${escapeHtml(e.actorEmail)} · ${dateLabel(e.createdAt)}</div>${e.detail?`<div class="small">${escapeHtml(e.detail)}</div>`:""}</li>`).join("")||"<li class=muted>No activity yet.</li>"}</ul></div></section></div>`;
    }
  } else if (view === "new-invoice") {
    const org = await prisma.saasOrg.findUnique({where:{id:input.id||""}});
    const today = new Date(); const due = new Date(today); due.setDate(due.getDate()+7);
    body = org?`${pageHead("Create invoice",`Draft a new invoice for ${org.schoolName}.`)}<section class="panel"><div class="panel-body"><form method="post" action="${input.basePath}/orgs/${encodeURIComponent(org.id)}/invoices">${csrfField(input.session)}<div class="form-grid"><div class="field"><label>Invoice date *</label><input name="issueDate" type="date" required value="${dateInput(today)}"></div><div class="field"><label>Due date *</label><input name="dueDate" type="date" required value="${dateInput(due)}"></div><div class="field full"><label>Description *</label><input name="description" required placeholder="Cultivate school ERP subscription"></div><div class="field"><label>Quantity *</label><input name="quantity" type="number" min="1" required value="1"></div><div class="field"><label>Unit price (₹) *</label><input name="unitPrice" type="number" min="1" required value="${org.monthlyPrice}"></div><div class="field"><label>GST rate (%)</label><select name="taxPercent"><option value="0">No GST</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option></select></div><div class="field full"><label>Invoice note</label><textarea name="notes" placeholder="Payment terms or customer-facing note"></textarea></div></div><div class="form-actions"><a class="btn" href="${baseUrl(input.basePath,{view:"org",id:org.id})}">Cancel</a><button class="btn primary" type="submit">Save draft</button></div></form></div></section>`:pageHead("Organisation not found","Choose an organisation before creating an invoice.");
  } else if (view === "invoice") {
    const invoice = await prisma.saasInvoice.findUnique({where:{id:input.id||""},include:{org:true,payments:{orderBy:{createdAt:"desc"}}}});
    if (!invoice) body=pageHead("Invoice not found","The requested invoice is unavailable.");
    else { const balance=invoice.total-invoice.paidAmount; body=`${pageHead(invoice.number,`${invoice.org.schoolName} · issued ${dateLabel(invoice.issueDate)}`,`<div class="actions"><a class="btn" target="_blank" href="${input.basePath}/invoices/${invoice.id}/print">Print / Save PDF</a>${invoice.status==="DRAFT"?`<form method="post" action="${input.basePath}/invoices/${invoice.id}/issue" onsubmit="return confirm('Issue this invoice? Financial details will be frozen.')">${csrfField(input.session)}<button class="btn primary">Issue invoice</button></form>`:""}</div>`)}<div class="split"><section class="panel"><div class="panel-head"><h2>Invoice details</h2>${badge(invoice.status)}</div><div class="panel-body"><div class="form-grid"><div><span class="muted small">BILL TO</span><h3>${escapeHtml(invoice.org.schoolName)}</h3><div class="muted">${escapeHtml(invoice.org.billingAddress||invoice.org.city)}<br>${escapeHtml(invoice.org.ownerEmail)}${invoice.org.gstin?`<br>GSTIN ${escapeHtml(invoice.org.gstin)}`:""}</div></div><div><span class="muted small">DATES</span><p>Invoice: ${dateLabel(invoice.issueDate)}<br>Due: ${dateLabel(invoice.dueDate)}</p></div></div><div class="table-wrap" style="margin-top:22px"><table><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Tax</th><th>Amount</th></tr></thead><tbody><tr><td>${escapeHtml(invoice.description)}</td><td>${invoice.quantity}</td><td>${money(invoice.unitPrice)}</td><td>${invoice.taxPercent}%</td><td class="num">${money(invoice.total)}</td></tr></tbody></table></div><div style="margin:24px 0 0 auto;width:min(320px,100%)"><div class="stack"><div style="display:flex;justify-content:space-between"><span class="muted">Subtotal</span><strong>${money(invoice.subtotal)}</strong></div><div style="display:flex;justify-content:space-between"><span class="muted">Tax</span><strong>${money(invoice.taxAmount)}</strong></div><div style="display:flex;justify-content:space-between;font-size:18px"><span>Total</span><strong>${money(invoice.total)}</strong></div><div style="display:flex;justify-content:space-between"><span class="muted">Paid</span><strong>${money(invoice.paidAmount)}</strong></div><div style="display:flex;justify-content:space-between;font-size:18px;color:#4f46e5"><span>Balance</span><strong>${money(balance)}</strong></div></div></div></div></section><div>${!["DRAFT","PAID","VOID"].includes(invoice.status)?`<section class="panel" style="margin-top:0"><div class="panel-head"><h2>Record payment</h2></div><div class="panel-body"><form method="post" action="${input.basePath}/invoices/${invoice.id}/payments">${csrfField(input.session)}<div class="stack"><div class="field"><label>Amount (₹)</label><input name="amount" type="number" min="1" max="${balance}" required value="${balance}"></div><div class="field"><label>Payment date</label><input name="paidAt" type="date" required value="${dateInput(new Date())}"></div><div class="field"><label>Method</label><select name="method"><option>BANK_TRANSFER</option><option>UPI</option><option>CARD</option><option>CASH</option><option>CHEQUE</option><option>RAZORPAY</option></select></div><div class="field"><label>Reference / UTR</label><input name="reference"></div><div class="field"><label>Internal note</label><textarea name="notes"></textarea></div><button class="btn primary" type="submit">Record payment</button></div></form></div></section>`:""}<section class="panel"><div class="panel-head"><h2>Payments</h2></div>${invoice.payments.length?`<div class="panel-body stack">${invoice.payments.map(p=>`<div><strong>${money(p.amount)}</strong> ${badge(p.status)}<div class="muted small">${dateLabel(p.paidAt)} · ${escapeHtml(p.provider)} · ${escapeHtml(p.paymentId||"No reference")}</div></div>`).join("")}</div>`:empty("No payments","Payments recorded against this invoice appear here.")}</section></div></div>`; }
  } else if (view === "invoices") {
    body=`${pageHead("Invoices","Track draft, issued, paid, and overdue customer invoices.")}<section class="panel"><div class="table-wrap">${allInvoices.length?`<table><thead><tr><th>Invoice</th><th>Organisation</th><th>Due</th><th>Status</th><th>Total</th><th>Balance</th></tr></thead><tbody>${allInvoices.map(i=>`<tr><td><a href="${baseUrl(input.basePath,{view:"invoice",id:i.id})}"><strong>${escapeHtml(i.number)}</strong></a></td><td>${escapeHtml(i.org.schoolName)}</td><td>${dateLabel(i.dueDate)}</td><td>${badge(i.status)}</td><td class="num">${money(i.total)}</td><td class="num">${money(i.total-i.paidAmount)}</td></tr>`).join("")}</tbody></table>`:empty("No invoices","Create an invoice from an organisation detail page.")}</div></section>`;
  } else if (view === "payments") {
    const payments=await prisma.saasPayment.findMany({orderBy:{createdAt:"desc"},include:{org:true,invoice:true},take:100});
    body=`${pageHead("Payments","A reconciled record of online and manually received payments.")}<section class="panel"><div class="table-wrap">${payments.length?`<table><thead><tr><th>Date</th><th>Organisation</th><th>Invoice</th><th>Method / reference</th><th>Amount</th><th>Status</th></tr></thead><tbody>${payments.map(p=>`<tr><td>${dateLabel(p.paidAt||p.createdAt)}</td><td>${escapeHtml(p.org.schoolName)}</td><td>${p.invoice?`<a href="${baseUrl(input.basePath,{view:"invoice",id:p.invoice.id})}">${escapeHtml(p.invoice.number)}</a>`:"—"}</td><td>${escapeHtml(p.provider)}<div class="muted small">${escapeHtml(p.paymentId||p.orderId||"")}</div></td><td class="num"><strong>${money(p.amount)}</strong></td><td>${badge(p.status)}</td></tr>`).join("")}</tbody></table>`:empty("No payments","Payments recorded against invoices appear here.")}</div></section>`;
  } else if (view === "followups") {
    const queue=orgs.filter(o=>o.nextFollowUpOn).sort((a,b)=>Number(a.nextFollowUpOn)-Number(b.nextFollowUpOn));
    body=`${pageHead("Follow-ups","Keep customer conversations and commercial next actions moving.")}<section class="panel"><div class="table-wrap">${queue.length?`<table><thead><tr><th>Due</th><th>Organisation</th><th>Owner</th><th>Status</th><th>Contact</th></tr></thead><tbody>${queue.map(o=>`<tr><td>${dateLabel(o.nextFollowUpOn)}</td><td><a href="${baseUrl(input.basePath,{view:"org",id:o.id})}"><strong>${escapeHtml(o.schoolName)}</strong></a></td><td>${escapeHtml(o.assignedOwner||"Unassigned")}</td><td>${badge(o.followUpStatus)}</td><td>${escapeHtml(o.ownerName)}<div class="muted small">${escapeHtml(o.ownerPhone)}</div></td></tr>`).join("")}</tbody></table>`:empty("No follow-ups scheduled","Add a next follow-up date on an organisation.")}</div></section>`;
  } else {
    body=`${pageHead("Settings","Security and portal configuration.")}<section class="panel"><div class="panel-body"><h3>Access policy</h3><p class="muted">Allowed: exact account <strong>buildtogether.tech@gmail.com</strong>, plus verified accounts at exactly <strong>anekio.com</strong> and <strong>anekio.in</strong>.</p><h3>Signed-in operator</h3><p>${escapeHtml(input.session.email)}</p><h3>Google OAuth</h3><p>${googleAdminAuthConfigured()?badge("ACTIVE"):`${badge("CONFIGURATION_REQUIRED")} <span class="muted">Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.</span>`}</p></div></section>`;
  }
  return adminDocument({ title: view === "dashboard" ? "Dashboard" : view.replaceAll("-"," "), basePath:input.basePath, session:input.session, view:view === "new-org"||view==="org"||view==="edit-org"?"organisations":view === "new-invoice"||view==="invoice"?"invoices":view, body, flash:input.flash, error:input.error });
}

export async function adminInvoicePrintHtml(id: string) {
  const invoice=await prisma.saasInvoice.findUnique({where:{id},include:{org:true}});
  if(!invoice)return null;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(invoice.number)}</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:0}.invoice{max-width:820px;margin:30px auto;padding:40px;border:1px solid #ddd}.head,.row{display:flex;justify-content:space-between;gap:30px}.brand{font-size:26px;font-weight:800}.muted{color:#667085}.box{margin:30px 0;padding:20px;background:#f8fafc}.line{width:100%;border-collapse:collapse;margin-top:30px}.line th,.line td{padding:12px;border-bottom:1px solid #ddd;text-align:left}.line th:last-child,.line td:last-child{text-align:right}.totals{width:320px;margin:30px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:7px}.total{font-size:20px;font-weight:800;border-top:2px solid #172033}@media print{.invoice{border:0;margin:0;max-width:none}.no-print{display:none}}@media(max-width:600px){.invoice{margin:0;padding:24px}.head,.row{display:grid}.totals{width:100%}}</style></head><body><main class="invoice"><button class="no-print" onclick="print()">Print / Save PDF</button><div class="head"><div><div class="brand">Anekio</div><div class="muted">Cultivate SaaS</div></div><div><h1>INVOICE</h1><strong>${escapeHtml(invoice.number)}</strong></div></div><div class="box row"><div><span class="muted">BILL TO</span><h3>${escapeHtml(invoice.org.schoolName)}</h3><div>${escapeHtml(invoice.org.billingAddress||invoice.org.city)}<br>${escapeHtml(invoice.org.ownerEmail)}${invoice.org.gstin?`<br>GSTIN ${escapeHtml(invoice.org.gstin)}`:""}</div></div><div><span class="muted">INVOICE DATE</span><p>${dateLabel(invoice.issueDate)}</p><span class="muted">DUE DATE</span><p>${dateLabel(invoice.dueDate)}</p></div></div><table class="line"><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Tax</th><th>Amount</th></tr></thead><tbody><tr><td>${escapeHtml(invoice.description)}</td><td>${invoice.quantity}</td><td>${money(invoice.unitPrice)}</td><td>${invoice.taxPercent}%</td><td>${money(invoice.total)}</td></tr></tbody></table><div class="totals"><div><span>Subtotal</span><span>${money(invoice.subtotal)}</span></div><div><span>Tax</span><span>${money(invoice.taxAmount)}</span></div><div class="total"><span>Total</span><span>${money(invoice.total)}</span></div><div><span>Paid</span><span>${money(invoice.paidAmount)}</span></div><div><strong>Balance</strong><strong>${money(invoice.total-invoice.paidAmount)}</strong></div></div>${invoice.notes?`<div class="box"><strong>Notes</strong><p>${escapeHtml(invoice.notes)}</p></div>`:""}</main></body></html>`;
}
