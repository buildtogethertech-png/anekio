import { prisma } from "./prisma";
import { googleAdminAuthConfigured, localAdminLoginAvailable, type SaasAdminSession } from "./saas-admin-auth";
import { PIPELINE_STAGES, firstName, greetingFor, isCustomerOrg } from "./saas-crm";
import { getSitePricing } from "./saas-pricing";
function escapeHtml(value: unknown) {
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

function dateTimeLabel(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (["ACTIVE", "PAID", "ISSUED", "WON", "COMPLETE", "DONE"].includes(status)) return "positive";
  if (["OVERDUE", "FAILED", "CANCELLED", "VOID", "LOST"].includes(status)) return "danger";
  if (["TRIAL", "PARTIALLY_PAID", "PAUSED", "PAYMENT", "IN_PROGRESS", "NOT_STARTED"].includes(status)) return "warning";
  return "neutral";
}

function activityIcon(action: string) {
  if (action.includes("PAYMENT")) return "💳";
  if (action.includes("SUBSCRIPTION") || action.includes("ONBOARDING")) return "🚀";
  if (action.includes("ORGANISATION") || action.includes("LEAD")) return "🏫";
  if (action.includes("DEMO")) return "🎥";
  if (action.includes("FOLLOW")) return "🔔";
  if (action.includes("NOTE") || action.includes("PROPOSAL")) return "📧";
  if (action.includes("SUPPORT")) return "🎫";
  return "•";
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

function navKey(view: string) {
  if (["lead", "new-lead"].includes(view)) return "leads";
  if (["org", "edit-org", "new-org"].includes(view)) return "organisations";
  if (["new-invoice", "invoice"].includes(view)) return "invoices";
  return view;
}

function icon(name: string) {
  const icons: Record<string, string> = {
    dashboard: "⌂",
    leads: "👥",
    demos: "📅",
    deals: "🤝",
    organisations: "🏫",
    subscriptions: "💳",
    invoices: "🧾",
    payments: "₹",
    pricing: "🏷",
    onboarding: "🚀",
    followups: "🔔",
    support: "🎫",
    settings: "⚙",
  };
  return icons[name] || "•";
}

function adminDocument(input: { title: string; basePath: string; session: SaasAdminSession; view: string; body: string; flash?: string; error?: string }) {
  const groups: { label: string; items: [string, string][] }[] = [
    { label: "", items: [["dashboard", "Dashboard"]] },
    { label: "CRM", items: [["leads", "Leads"], ["demos", "Demos"], ["deals", "Deals"]] },
    { label: "Customers", items: [["organisations", "Organisations"], ["subscriptions", "Subscriptions"]] },
    { label: "Billing", items: [["invoices", "Invoices"], ["payments", "Payments"], ["pricing", "Pricing"]] },
    { label: "Operations", items: [["onboarding", "Onboarding"], ["followups", "Follow-ups"], ["support", "Support"]] },
    { label: "", items: [["settings", "Settings"]] },
  ];
  const mobile: [string, string][] = [
    ["dashboard", "Home"],
    ["leads", "Leads"],
    ["organisations", "Schools"],
    ["followups", "Follow"],
    ["onboarding", "Setup"],
  ];
  const link = (view: string) => baseUrl(input.basePath, view === "dashboard" ? {} : { view });
  const active = navKey(input.view);
  const navHtml = groups
    .map((group) => {
      const items = group.items
        .map(([key, label]) => `<a class="${active === key ? "active" : ""}" href="${link(key)}"><span class="nav-icon">${icon(key)}</span>${label}</a>`)
        .join("");
      return `${group.label ? `<div class="nav-label">${group.label}</div>` : ""}<div class="nav">${items}</div>`;
    })
    .join("");
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(input.title)} · Anekio Admin</title><style>
  :root{--bg:#f5f7fb;--panel:#fff;--ink:#172033;--muted:#697386;--line:#e5e9f0;--brand:#4f46e5;--brand2:#7c3aed;--green:#067647;--greenbg:#ecfdf3;--amber:#b54708;--amberbg:#fffaeb;--red:#b42318;--redbg:#fef3f2;--nav:#111827;--shadow:0 12px 30px rgba(17,24,39,.06)}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px}a{color:inherit;text-decoration:none}button,input,select,textarea{font:inherit}.layout{min-height:100vh;display:grid;grid-template-columns:248px 1fr}.sidebar{position:sticky;top:0;height:100vh;background:var(--nav);color:#d1d5db;padding:24px 16px;display:flex;flex-direction:column;overflow:auto}.brand{display:flex;align-items:center;gap:11px;color:#fff;font-size:18px;font-weight:800;padding:0 10px 18px}.mark{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:linear-gradient(135deg,var(--brand),var(--brand2));font-weight:900}.nav{display:grid;gap:4px;margin-bottom:8px}.nav-label{padding:12px 12px 6px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9ca3af;font-weight:800}.nav a{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:9px;font-weight:650}.nav a:hover,.nav a.active{background:#293244;color:#fff}.nav-icon{width:20px;text-align:center}.user{margin-top:auto;padding:14px 10px 0;border-top:1px solid #2d3748}.user b{display:block;color:#fff;font-size:13px}.user span{display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis}.user a{display:inline-block;margin-top:10px;color:#c7d2fe;font-weight:700}.main{min-width:0}.topbar{height:66px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 32px;position:sticky;top:0;z-index:5}.topbar .mobile-brand{display:none;font-weight:800}.search{width:min(420px,50vw);position:relative}.search input{width:100%;background:#f8fafc;border:1px solid var(--line);border-radius:9px;padding:10px 12px}.content{width:min(1320px,100%);padding:30px 32px 60px}.page-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:24px}.page-head h1{margin:0;font-size:28px;letter-spacing:-.025em}.page-head p{margin:7px 0 0;color:var(--muted)}.hello{margin:0 0 22px}.hello h1{margin:0;font-size:28px}.btn{border:1px solid #d0d5dd;background:#fff;border-radius:9px;padding:10px 14px;font-weight:750;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px}.btn:hover{background:#f8fafc}.btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}.btn.danger{color:var(--red)}.grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.metric,.panel{background:var(--panel);border:1px solid var(--line);border-radius:13px;box-shadow:var(--shadow)}.metric{padding:18px}.metric span{display:block;color:var(--muted);font-size:12px;font-weight:700}.metric strong{display:block;font-size:26px;margin-top:8px;letter-spacing:-.03em}.panel{margin-top:18px;overflow:hidden}.panel-head{padding:17px 19px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}.panel-head h2{margin:0;font-size:16px}.panel-body{padding:19px}.split{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,.7fr);gap:18px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th{padding:11px 14px;text-align:left;color:var(--muted);background:#f9fafb;font-size:11px;text-transform:uppercase;letter-spacing:.05em}td{padding:14px;border-top:1px solid var(--line);vertical-align:middle}tbody tr:hover{background:#fafbff}.num{text-align:right;font-variant-numeric:tabular-nums}.muted{color:var(--muted)}.small{font-size:12px}.badge{display:inline-flex;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:800;background:#f2f4f7;color:#475467}.badge.positive{color:var(--green);background:var(--greenbg)}.badge.warning{color:var(--amber);background:var(--amberbg)}.badge.danger{color:var(--red);background:var(--redbg)}.flash{border-radius:10px;padding:12px 14px;margin-bottom:18px;font-weight:650}.flash.ok{background:var(--greenbg);color:var(--green);border:1px solid #abefc6}.flash.error{background:var(--redbg);color:var(--red);border:1px solid #fecdca}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.field{display:grid;gap:6px}.field.full{grid-column:1/-1}.field label{font-size:12px;font-weight:750;color:#344054}.field input,.field select,.field textarea{width:100%;border:1px solid #d0d5dd;border-radius:9px;background:#fff;padding:10px 11px;color:var(--ink);outline:none}.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--brand);box-shadow:0 0 0 3px #e0e7ff}.field textarea{min-height:92px;resize:vertical}.form-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.detail-head{background:linear-gradient(135deg,#fff,#f7f7ff);border:1px solid var(--line);border-radius:14px;padding:22px;display:flex;justify-content:space-between;gap:18px}.detail-head h1{margin:4px 0 8px}.detail-stats{display:flex;gap:24px;align-items:center}.detail-stats span{display:block;color:var(--muted);font-size:11px}.detail-stats strong{font-size:18px}.empty{padding:40px 20px;text-align:center;color:var(--muted)}.empty strong{display:block;color:var(--ink);font-size:16px;margin-bottom:6px}.actions{display:flex;gap:8px;flex-wrap:wrap}.stack{display:grid;gap:10px}.activity{padding:0;margin:0;list-style:none}.activity li{padding:12px 0;border-bottom:1px solid var(--line)}.activity li:last-child{border:0}.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:16px 0}.tabs a{padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:#fff;font-weight:700;font-size:13px}.tabs a.active{background:#eef2ff;border-color:#c7d2fe;color:#3730a3}.pipeline{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}.pipe{text-align:center;padding:12px 8px;border:1px solid var(--line);border-radius:12px;background:#fff}.pipe strong{display:block;font-size:22px}.pipe span{color:var(--muted);font-size:11px;font-weight:700}.kanban{display:grid;grid-template-columns:repeat(6,minmax(180px,1fr));gap:12px;overflow:auto;padding:16px}.kanban-col{background:#f8fafc;border:1px solid var(--line);border-radius:12px;padding:10px;min-height:180px}.kanban-col h3{margin:0 0 10px;font-size:12px}.card-mini{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px}.progress{height:10px;background:#eef2ff;border-radius:999px;overflow:hidden}.progress b{display:block;height:100%;background:linear-gradient(90deg,var(--brand),var(--brand2))}.check{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}.stepper{display:grid;gap:0}.stepper div{padding:8px 0 8px 18px;border-left:2px solid #e5e7eb;position:relative}.stepper div:before{content:"";position:absolute;left:-5px;top:14px;width:8px;height:8px;border-radius:50%;background:#c7d2fe}.stepper .on:before{background:var(--brand)}.due-hot{color:var(--red);font-weight:800}.due-soon{color:var(--amber);font-weight:800}.mobile-nav{display:none}.print-only{display:none}@media(max-width:980px){.grid4,.pipeline{grid-template-columns:repeat(2,1fr)}.split{grid-template-columns:1fr}.layout{grid-template-columns:210px 1fr}.content{padding:24px 20px}.topbar{padding:0 20px}}@media(max-width:720px){.layout{display:block}.sidebar{display:none}.topbar{height:58px;padding:0 16px}.topbar .mobile-brand{display:block}.search{width:62%}.content{padding:20px 14px 82px}.grid4{grid-template-columns:1fr 1fr;gap:10px}.metric{padding:14px}.metric strong{font-size:21px}.page-head,.detail-head{display:grid}.page-head h1{font-size:24px}.detail-stats{display:grid;grid-template-columns:repeat(2,1fr)}.form-grid{grid-template-columns:1fr}.field.full{grid-column:auto}.panel{border-radius:11px}.mobile-nav{display:grid;grid-template-columns:repeat(5,1fr);position:fixed;z-index:9;bottom:0;left:0;right:0;background:#fff;border-top:1px solid var(--line);padding:7px 4px env(safe-area-inset-bottom)}.mobile-nav a{font-size:10px;text-align:center;color:var(--muted)}.mobile-nav span{display:block;font-size:18px;color:var(--ink)}}@media(max-width:430px){.grid4{grid-template-columns:1fr}.search{width:58%}.table-wrap{margin:0 -19px}th,td{padding:12px 10px}}
  </style></head><body><div class="layout"><aside class="sidebar"><div class="brand"><span class="mark">A</span><span>Anekio Admin</span></div>${navHtml}<div class="user"><b>Internal operator</b><span>${escapeHtml(input.session.email)}</span><a href="${input.basePath}/logout">Sign out</a></div></aside><main class="main"><header class="topbar"><span class="mobile-brand">Anekio</span><form class="search" method="get" action="${input.basePath || "/"}"><input type="hidden" name="view" value="${active === "leads" ? "leads" : "organisations"}"><input name="q" placeholder="Search organisations…" aria-label="Search organisations"></form><span class="muted small">Internal · secure</span></header><div class="content">${input.flash ? `<div class="flash ok">${escapeHtml(input.flash)}</div>` : ""}${input.error ? `<div class="flash error">${escapeHtml(input.error)}</div>` : ""}${input.body}</div></main></div><nav class="mobile-nav">${mobile.map(([key, label]) => `<a href="${link(key)}"><span>${icon(key)}</span>${label}</a>`).join("")}</nav></body></html>`;
}

function pageHead(title: string, description: string, action = "") {
  return `<div class="page-head"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${action}</div>`;
}

function empty(title: string, body: string, action = "") {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p>${action}</div>`;
}

function orgForm(basePath: string, session: SaasAdminSession, org?: any, asLead = false) {
  const action = org ? `${basePath}/orgs/${encodeURIComponent(org.id)}` : `${basePath}/orgs`;
  const value = (key: string) => escapeHtml(org?.[key] ?? "");
  const selected = (key: string, option: string) => (String(org?.[key] || (key === "subscriptionStatus" ? "LEAD" : key === "pipelineStage" ? "NEW" : "LEAD")) === option ? " selected" : "");
  return `<form method="post" action="${action}">${csrfField(session)}<input type="hidden" name="lifecycle" value="${asLead && !org ? "LEAD" : escapeHtml(org?.lifecycle || "LEAD")}"><div class="form-grid"><div class="field"><label>School name *</label><input name="schoolName" required value="${value("schoolName")}"></div><div class="field"><label>City</label><input name="city" value="${value("city")}"></div><div class="field"><label>Primary contact *</label><input name="ownerName" required value="${value("ownerName")}"></div><div class="field"><label>Phone *</label><input name="ownerPhone" required inputmode="tel" value="${value("ownerPhone")}"></div><div class="field"><label>Email *</label><input name="ownerEmail" required type="email" value="${value("ownerEmail")}"></div><div class="field"><label>Account manager</label><input name="assignedOwner" value="${value("assignedOwner")}" placeholder="Who owns this account?"></div><div class="field"><label>Source</label><select name="source">${["MANUAL", "WEBSITE_DEMO", "WEBSITE_TRIAL", "REFERRAL"].map((x) => `<option${selected("source", x)}>${x}</option>`).join("")}</select></div><div class="field"><label>Interested in</label><input name="interestedIn" value="${value("interestedIn")}" placeholder="Full ERP"></div><div class="field"><label>Students</label><input name="studentCount" type="number" min="0" value="${value("studentCount")}"></div><div class="field"><label>Teachers</label><input name="teacherCount" type="number" min="0" value="${value("teacherCount")}"></div><div class="field"><label>Pipeline</label><select name="pipelineStage">${PIPELINE_STAGES.map((x) => `<option${selected("pipelineStage", x)}>${x}</option>`).join("")}</select></div><div class="field"><label>Lifecycle</label><select name="subscriptionStatus">${["LEAD", "TRIAL", "ACTIVE", "PAUSED", "CANCELLED", "CLOSED"].map((x) => `<option${selected("subscriptionStatus", x)}>${x}</option>`).join("")}</select></div><div class="field"><label>Plan</label><input name="plan" value="${value("plan")}" placeholder="Launch"></div><div class="field"><label>Plan amount (₹)</label><input name="monthlyPrice" type="number" min="0" value="${value("monthlyPrice") || "14999"}"></div><div class="field"><label>Renewal date</label><input name="renewalOn" type="date" value="${dateInput(org?.renewalOn)}"></div><div class="field"><label>Next follow-up</label><input name="nextFollowUpOn" type="date" value="${dateInput(org?.nextFollowUpOn)}"></div><div class="field"><label>GSTIN</label><input name="gstin" maxlength="15" value="${value("gstin")}"></div><div class="field"><label>State</label><input name="billingState" value="${value("billingState")}"></div><div class="field full"><label>Billing address</label><textarea name="billingAddress">${value("billingAddress")}</textarea></div><div class="field full"><label>Internal notes</label><textarea name="notes">${value("notes")}</textarea></div></div><div class="form-actions"><a class="btn" href="${baseUrl(basePath, { view: asLead ? "leads" : "organisations" })}">Cancel</a><button class="btn primary" type="submit">${org ? "Save changes" : asLead ? "Add lead" : "Add organisation"}</button></div></form>`;
}

function pipelineBar(orgs: { pipelineStage: string }[]) {
  return `<div class="pipeline">${PIPELINE_STAGES.map((stage) => `<div class="pipe"><strong>${orgs.filter((o) => o.pipelineStage === stage).length}</strong><span>${stage.replaceAll("_", " ")}</span></div>`).join("")}</div>`;
}

function orgTabs(basePath: string, id: string, tab: string, isLead: boolean) {
  const view = isLead ? "lead" : "org";
  const tabs = isLead
    ? [["overview", "Overview"], ["pipeline", "Pipeline"], ["activity", "Activity"], ["notes", "Notes"]]
    : [["overview", "Overview"], ["subscription", "Subscription"], ["billing", "Billing"], ["onboarding", "Onboarding"], ["activity", "Activity"], ["notes", "Notes"]];
  return `<nav class="tabs">${tabs.map(([key, label]) => `<a class="${tab === key ? "active" : ""}" href="${baseUrl(basePath, { view, id, tab: key })}">${label}</a>`).join("")}</nav>`;
}

export function adminLoginHtml(basePath: string, error = "") {
  const configured = googleAdminAuthConfigured();
  const localLogin = localAdminLoginAvailable();
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Sign in · Anekio Admin</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top left,#ede9fe,transparent 38%),#f7f8fc;color:#182033;font-family:Inter,system-ui,sans-serif}.card{width:min(430px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:32px;box-shadow:0 24px 60px rgba(17,24,39,.12)}.mark{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-size:22px;font-weight:900}h1{font-size:27px;margin:22px 0 8px}p{color:#667085;line-height:1.6}.btn{width:100%;display:flex;align-items:center;justify-content:center;border:0;border-radius:10px;padding:12px 16px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:800;margin-top:16px;cursor:pointer}.note,.error{border-radius:10px;padding:12px;margin-top:16px;font-size:13px}.note{background:#f2f4f7;color:#475467}.error{background:#fef3f2;color:#b42318}.fine{font-size:12px;margin-top:18px}.local{display:grid;gap:12px;margin-top:20px;padding-top:20px;border-top:1px solid #e5e7eb}.local label{display:grid;gap:6px;font-size:12px;font-weight:750}.local input{width:100%;border:1px solid #d0d5dd;border-radius:9px;padding:11px;font:inherit}.local input:focus{outline:0;border-color:#4f46e5;box-shadow:0 0 0 3px #e0e7ff}.divider{text-align:center;color:#98a2b3;font-size:12px;margin-top:16px}</style></head><body><main class="card"><div class="mark">A</div><h1>Sign in to Anekio Admin</h1><p>Manage leads, organisations, subscriptions, invoices, payments, and onboarding.</p>${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}${localLogin ? `<form class="local" method="post" action="${basePath}/login"><strong>Local testing</strong><label>Allowed email<input name="email" type="email" required autocomplete="username" value="buildtogether.tech@gmail.com"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label><button class="btn" type="submit">Sign in locally</button></form>` : ""}${configured ? `${localLogin ? `<div class="divider">OR</div>` : ""}<a class="btn" href="${basePath}/auth/google">Continue with Google</a>` : localLogin ? "" : `<div class="note"><strong>Google sign-in needs configuration.</strong><br>Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then register this portal's callback URL in Google Cloud.</div>`}<p class="fine">Access is limited to buildtogether.tech@gmail.com and verified @anekio.com / @anekio.in accounts.${localLogin ? " Local password sign-in is disabled automatically in production." : ""}</p></main></body></html>`;
}

export async function adminPortalHtml(input: {
  basePath: string;
  session: SaasAdminSession;
  view?: string;
  id?: string;
  q?: string;
  tab?: string;
  flash?: string;
  error?: string;
}) {
  const view = input.view || "dashboard";
  const tab = input.tab || "overview";
  const orgs = await prisma.saasOrg.findMany({
    where: input.q
      ? { OR: [{ schoolName: { contains: input.q } }, { ownerName: { contains: input.q } }, { ownerEmail: { contains: input.q } }, { ownerPhone: { contains: input.q } }] }
      : undefined,
    orderBy: { updatedAt: "desc" },
    include: {
      invoices: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" }, take: 5 },
      subscriptions: { orderBy: { createdAt: "desc" } },
      followUps: { where: { status: "OPEN" }, orderBy: { dueOn: "asc" } },
      onboardingTasks: { orderBy: { sortOrder: "asc" } },
    },
  });
  const leads = orgs.filter((o) => !isCustomerOrg(o));
  const customers = orgs.filter((o) => isCustomerOrg(o));
  const allInvoices = await prisma.saasInvoice.findMany({ orderBy: { createdAt: "desc" }, include: { org: true }, take: 100 });
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date();
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const monthPayments = await prisma.saasPayment.aggregate({ where: { status: "PAID", paidAt: { gte: monthStart } }, _sum: { amount: true } });
  const demosThisWeek = await prisma.saasDemo.count({ where: { scheduledAt: { gte: weekStart } } });
  const openFollowUps = await prisma.saasFollowUp.findMany({ where: { status: "OPEN" }, include: { org: true }, orderBy: { dueOn: "asc" }, take: 50 });
  const subscriptions = await prisma.saasSubscription.findMany({ orderBy: { createdAt: "desc" }, include: { org: true }, take: 100 });
  let body = "";

  if (view === "dashboard") {
    const paymentDue = orgs.filter((o) => o.pipelineStage === "PAYMENT" || o.paymentStatus === "PENDING" || o.invoices.some((i) => !["DRAFT", "PAID", "VOID"].includes(i.status)));
    const onboardingQueue = customers.filter((o) => o.onboardingStatus !== "COMPLETE");
    const followOrgIds = new Set(openFollowUps.map((f) => f.orgId));
    const attention = orgs.filter((o) => paymentDue.some((p) => p.id === o.id) || o.lifecycle === "TRIAL" || followOrgIds.has(o.id)).slice(0, 8);
    const recentCustomers = customers.slice(0, 8);
    const newestPaid = customers.find((o) => o.paymentStatus === "PAID" && o.lifecycle === "CUSTOMER");
    body = `<div class="hello"><h1>${greetingFor()}, ${escapeHtml(firstName(input.session.email))}</h1><p class="muted">Here's what needs your attention today.</p></div>
      <section class="grid4">
        <div class="metric"><span>Total schools</span><strong>${orgs.length}</strong></div>
        <div class="metric"><span>Active subscriptions</span><strong>${orgs.filter((o) => o.subscriptionStatus === "ACTIVE").length}</strong></div>
        <div class="metric"><span>Trials</span><strong>${orgs.filter((o) => o.lifecycle === "TRIAL" || o.subscriptionStatus === "TRIAL").length}</strong></div>
        <div class="metric"><span>New leads</span><strong>${leads.filter((o) => o.pipelineStage === "NEW").length}</strong></div>
        <div class="metric"><span>Demos this week</span><strong>${demosThisWeek}</strong></div>
        <div class="metric"><span>Revenue</span><strong>${money(monthPayments._sum.amount || 0)}</strong></div>
        <div class="metric"><span>Payment due</span><strong>${paymentDue.length}</strong></div>
        <div class="metric"><span>Onboarding</span><strong>${onboardingQueue.length}</strong></div>
      </section>
      ${newestPaid ? `<section class="panel"><div class="panel-head"><h2>New customer 🎉</h2>${badge("PAID")}</div><div class="panel-body"><strong>${escapeHtml(newestPaid.schoolName)}</strong><div class="form-grid" style="margin-top:12px"><div><span class="muted small">Plan</span><div>${escapeHtml(newestPaid.plan)}</div></div><div><span class="muted small">Amount</span><div>${money(newestPaid.monthlyPrice)} / year</div></div><div><span class="muted small">Subscription</span><div>${badge(newestPaid.subscriptionStatus)}</div></div><div><span class="muted small">Onboarding</span><div>${badge(newestPaid.onboardingStatus)}</div></div><div><span class="muted small">Account manager</span><div>${escapeHtml(newestPaid.assignedOwner || "Unassigned")}</div></div></div><div class="actions" style="margin-top:14px"><a class="btn primary" href="${baseUrl(input.basePath, { view: "org", id: newestPaid.id, tab: "onboarding" })}">Start onboarding →</a></div></div></section>` : ""}
      <section class="panel"><div class="panel-head"><h2>Sales pipeline</h2><a class="small muted" href="${baseUrl(input.basePath, { view: "deals" })}">Open board →</a></div><div class="panel-body">${pipelineBar(orgs)}</div></section>
      <div class="split">
        <section class="panel"><div class="panel-head"><h2>Needs attention</h2></div>${attention.length ? `<div class="table-wrap"><table><thead><tr><th>School</th><th>Why</th><th>Next action</th></tr></thead><tbody>${attention
          .map((o) => `<tr><td><a href="${baseUrl(input.basePath, { view: isCustomerOrg(o) ? "org" : "lead", id: o.id })}"><strong>${escapeHtml(o.schoolName)}</strong></a></td><td>${badge(o.pipelineStage || o.subscriptionStatus)}</td><td>${escapeHtml(o.followUps?.[0]?.nextAction || o.followUpStatus.replaceAll("_", " "))}</td></tr>`)
          .join("")}</tbody></table></div>` : empty("Everything is clear", "No schools need attention right now.")}</section>
        <div>
          <section class="panel"><div class="panel-head"><h2>Onboarding</h2><a class="small muted" href="${baseUrl(input.basePath, { view: "onboarding" })}">View all →</a></div>${onboardingQueue.length ? `<div class="panel-body stack">${onboardingQueue
            .slice(0, 5)
            .map((o) => {
              const total = o.onboardingTasks.length || 8;
              const done = o.onboardingTasks.filter((t) => t.done).length;
              const pct = Math.round((done / total) * 100);
              return `<a href="${baseUrl(input.basePath, { view: "org", id: o.id, tab: "onboarding" })}"><strong>${escapeHtml(o.schoolName)}</strong><div class="progress" style="margin-top:6px"><b style="width:${pct}%"></b></div><div class="muted small">${pct}%</div></a>`;
            })
            .join("")}</div>` : empty("No onboarding queue", "New customers appear here after payment.")}</section>
        </div>
      </div>
      <section class="panel"><div class="panel-head"><h2>Recent customers</h2></div>${recentCustomers.length ? `<div class="table-wrap"><table><thead><tr><th>School</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead><tbody>${recentCustomers
        .map((o) => `<tr><td><a href="${baseUrl(input.basePath, { view: "org", id: o.id })}"><strong>${escapeHtml(o.schoolName)}</strong></a></td><td>${escapeHtml(o.plan)}</td><td class="num">${o.monthlyPrice ? money(o.monthlyPrice) : "—"}</td><td>${badge(o.subscriptionStatus)}</td></tr>`)
        .join("")}</tbody></table></div>` : empty("No customers yet", "Won deals become organisations here.")}</section>`;
  } else if (view === "leads" || view === "new-lead") {
    if (view === "new-lead") body = `${pageHead("Add lead", "Capture a school before they become a paying organisation.")}<section class="panel"><div class="panel-body">${orgForm(input.basePath, input.session, undefined, true)}</div></section>`;
    else
      body = `${pageHead("Leads", input.q ? `Search results for “${input.q}”` : "Website demos, trials, and outbound schools still in CRM.", `<a class="btn primary" href="${baseUrl(input.basePath, { view: "new-lead" })}">＋ Add lead</a>`)}<section class="panel"><div class="table-wrap">${leads.length ? `<table><thead><tr><th>School</th><th>Contact</th><th>Source</th><th>Stage</th><th>Students</th><th>Owner</th></tr></thead><tbody>${leads
        .map(
          (o) =>
            `<tr><td><a href="${baseUrl(input.basePath, { view: "lead", id: o.id })}"><strong>${escapeHtml(o.schoolName)}</strong><div class="muted small">${escapeHtml(o.city || "")}</div></a></td><td>${escapeHtml(o.ownerName)}<div class="muted small">${escapeHtml(o.ownerPhone)}</div></td><td>${escapeHtml(o.source.replaceAll("_", " "))}</td><td>${badge(o.pipelineStage)}</td><td>${o.studentCount ?? "—"}</td><td>${escapeHtml(o.assignedOwner || "Unassigned")}</td></tr>`
        )
        .join("")}</tbody></table>` : empty("No leads yet", "Book Demo and Start Trial on the website land here.", `<a class="btn primary" href="${baseUrl(input.basePath, { view: "new-lead" })}">Add lead</a>`)}</div></section>`;
  } else if (view === "deals") {
    const stages = PIPELINE_STAGES.filter((s) => s !== "WON");
    body = `${pageHead("Deals", "Move schools through New → Contacted → Demo → Qualified → Proposal → Payment.")}<section class="panel"><div class="kanban">${stages
      .map((stage) => `<div class="kanban-col"><h3>${stage} · ${orgs.filter((o) => o.pipelineStage === stage).length}</h3>${orgs
        .filter((o) => o.pipelineStage === stage)
        .map(
          (o) =>
            `<a class="card-mini" href="${baseUrl(input.basePath, { view: isCustomerOrg(o) ? "org" : "lead", id: o.id })}"><strong>${escapeHtml(o.schoolName)}</strong><div class="muted small">${escapeHtml(o.ownerName)}</div><form method="post" action="${input.basePath}/crm/${o.id}/stage" style="margin-top:8px">${csrfField(input.session)}<select name="stage" onchange="this.form.submit()">${PIPELINE_STAGES.map((s) => `<option${s === o.pipelineStage ? " selected" : ""}>${s}</option>`).join("")}</select></form></a>`
        )
        .join("")}</div>`)
      .join("")}</div></section>`;
  } else if (view === "demos") {
    const demos = await prisma.saasDemo.findMany({ orderBy: { scheduledAt: "desc" }, include: { org: true }, take: 80 });
    body = `${pageHead("Demos", "Scheduled and completed product demos.")}<section class="panel"><div class="table-wrap">${demos.length ? `<table><thead><tr><th>When</th><th>School</th><th>Owner</th><th>Status</th><th></th></tr></thead><tbody>${demos
      .map(
        (d) =>
          `<tr><td>${dateTimeLabel(d.scheduledAt)}</td><td><a href="${baseUrl(input.basePath, { view: "lead", id: d.orgId })}">${escapeHtml(d.org.schoolName)}</a></td><td>${escapeHtml(d.assignedTo || d.org.assignedOwner || "Unassigned")}</td><td>${badge(d.status)}</td><td>${d.status === "SCHEDULED" ? `<form method="post" action="${input.basePath}/crm/demos/${d.id}/complete">${csrfField(input.session)}<button class="btn">Mark completed</button></form>` : ""}</td></tr>`
      )
      .join("")}</tbody></table>` : empty("No demos yet", "Schedule a demo from a lead page.")}</div></section>`;
  } else if (view === "organisations" || view === "new-org") {
    if (view === "new-org") body = `${pageHead("Add organisation", "Create the customer record. Subscription stays a separate object.")}<section class="panel"><div class="panel-body">${orgForm(input.basePath, input.session)}</div></section>`;
    else
      body = `${pageHead("Organisations", input.q ? `Search results for “${input.q}”` : "Paying and onboarded schools. The organisation stays the same when the plan changes.", `<a class="btn primary" href="${baseUrl(input.basePath, { view: "new-org" })}">＋ Add organisation</a>`)}<section class="panel"><div class="table-wrap">${customers.length || input.q ? `<table><thead><tr><th>Organisation</th><th>Contact</th><th>Subscription</th><th>Plan</th><th>Onboarding</th></tr></thead><tbody>${(input.q ? orgs : customers)
        .map(
          (o) =>
            `<tr><td><a href="${baseUrl(input.basePath, { view: isCustomerOrg(o) ? "org" : "lead", id: o.id })}"><strong>${escapeHtml(o.schoolName)}</strong><div class="muted small">${escapeHtml(o.city || "City not added")}</div></a></td><td>${escapeHtml(o.ownerName)}<div class="muted small">${escapeHtml(o.ownerEmail)}</div></td><td>${badge(o.subscriptionStatus)}</td><td>${escapeHtml(o.plan)}<div class="muted small">${money(o.monthlyPrice)}</div></td><td>${badge(o.onboardingStatus)}</td></tr>`
        )
        .join("")}</tbody></table>` : empty("No organisations yet", "Leads convert here after payment.", `<a class="btn primary" href="${baseUrl(input.basePath, { view: "new-org" })}">Add organisation</a>`)}</div></section>`;
  } else if (view === "org" || view === "edit-org" || view === "lead") {
    const org = await prisma.saasOrg.findUnique({
      where: { id: input.id || "" },
      include: {
        invoices: { orderBy: { createdAt: "desc" } },
        payments: { orderBy: { createdAt: "desc" } },
        auditEvents: { orderBy: { createdAt: "desc" }, take: 40 },
        subscriptions: { orderBy: { createdAt: "desc" } },
        demos: { orderBy: { scheduledAt: "desc" } },
        followUps: { orderBy: { dueOn: "asc" } },
        onboardingTasks: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!org) body = pageHead("Not found", "The requested school is unavailable.");
    else if (view === "edit-org") body = `${pageHead(`Edit ${org.schoolName}`, "Update contact, commercial, billing, and follow-up information.")}<section class="panel"><div class="panel-body">${orgForm(input.basePath, input.session, org, !isCustomerOrg(org))}</div></section>`;
    else {
      const isLead = view === "lead";
      const currentSub = org.subscriptions.find((s) => ["ACTIVE", "TRIAL"].includes(s.status)) || org.subscriptions[0];
      const tasks = org.onboardingTasks;
      const pct = tasks.length ? Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100) : 0;
      const header = `<section class="detail-head"><div><div class="muted small">${isLead ? "LEAD" : "ORGANISATION"} · Customer since ${dateLabel(org.customerSince || org.createdAt)}</div><h1>${escapeHtml(org.schoolName)}</h1><div class="actions">${badge(isLead ? "LEAD" : org.subscriptionStatus)} ${badge(org.pipelineStage)}</div></div><div class="detail-stats"><div><span>Plan</span><strong>${escapeHtml(org.plan || "—")}</strong></div><div><span>Amount</span><strong>${org.monthlyPrice ? `${money(org.monthlyPrice)} / year` : "—"}</strong></div><div><span>Manager</span><strong>${escapeHtml(org.assignedOwner || "Unassigned")}</strong></div></div><div class="actions"><a class="btn" href="${baseUrl(input.basePath, { view: "edit-org", id: org.id })}">Edit</a>${isLead ? `<form method="post" action="${input.basePath}/crm/${org.id}/stage">${csrfField(input.session)}<input type="hidden" name="stage" value="PAYMENT"><button class="btn">Convert to payment</button></form>` : `<a class="btn primary" href="${baseUrl(input.basePath, { view: "new-invoice", id: org.id })}">Create invoice</a>`}</div></section>${orgTabs(input.basePath, org.id, tab, isLead)}`;
      let panel = "";
      if (tab === "subscription") {
        panel = `<section class="panel"><div class="panel-head"><h2>Subscription</h2></div><div class="panel-body">${currentSub ? `<strong>${escapeHtml(currentSub.plan)}</strong><p>${money(currentSub.amount)} / ${escapeHtml(currentSub.cycle.toLowerCase())}</p><div class="form-grid"><div><span class="muted small">Status</span><div>${badge(currentSub.status)}</div></div><div><span class="muted small">Started</span><div>${dateLabel(currentSub.startedAt)}</div></div><div><span class="muted small">Renews</span><div>${dateLabel(currentSub.renewsAt)}</div></div><div><span class="muted small">Payment</span><div>${badge(currentSub.paymentStatus)}</div></div></div><div class="actions" style="margin-top:16px"><form method="post" action="${input.basePath}/crm/${org.id}/plan">${csrfField(input.session)}<div class="form-grid"><div class="field"><label>Change plan</label><input name="plan" value="${escapeHtml(currentSub.plan)}"></div><div class="field"><label>Amount</label><input name="amount" type="number" value="${currentSub.amount}"></div></div><button class="btn" style="margin-top:10px">Save plan</button></form><form method="post" action="${input.basePath}/crm/${org.id}/cancel" onsubmit="return confirm('Cancel this subscription?')">${csrfField(input.session)}<button class="btn danger">Cancel subscription</button></form></div>` : empty("No subscription", "A subscription is created when a trial starts or payment succeeds.")}<h3 style="margin-top:24px">History</h3><div class="stepper">${org.subscriptions.map((s) => `<div class="on"><strong>${escapeHtml(s.plan)}</strong> ${badge(s.status)}<div class="muted small">${escapeHtml(s.history || dateLabel(s.startedAt))}</div></div>`).join("") || "<div>No history yet.</div>"}</div></div></section>`;
      } else if (tab === "billing") {
        panel = `<section class="panel"><div class="panel-head"><h2>Invoices</h2><a class="btn" href="${baseUrl(input.basePath, { view: "new-invoice", id: org.id })}">＋ New invoice</a></div>${org.invoices.length ? `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>${org.invoices.map((i) => `<tr><td><a href="${baseUrl(input.basePath, { view: "invoice", id: i.id })}"><strong>${escapeHtml(i.number)}</strong></a></td><td>${dateLabel(i.issueDate)}</td><td class="num">${money(i.total)}</td><td>${badge(i.status)}</td></tr>`).join("")}</tbody></table></div>` : empty("No invoices", "Create an invoice when commercial terms are ready.")}</section>`;
      } else if (tab === "onboarding") {
        panel = `<section class="panel"><div class="panel-head"><h2>Onboarding ${pct}%</h2><form method="post" action="${input.basePath}/crm/${org.id}/onboarding/start">${csrfField(input.session)}<button class="btn primary">Start onboarding</button></form></div><div class="panel-body"><div class="progress"><b style="width:${pct}%"></b></div><div class="stack" style="margin-top:16px">${(tasks.length ? tasks : []).map((t) => `<form class="check" method="post" action="${input.basePath}/crm/${org.id}/onboarding/${encodeURIComponent(t.key)}">${csrfField(input.session)}<button class="btn" type="submit">${t.done ? "✓" : "○"}</button><span>${escapeHtml(t.label)}</span></form>`).join("") || empty("Not started", "Start onboarding after payment.")}<div class="muted" style="margin-top:16px">Account manager: ${escapeHtml(org.assignedOwner || "Unassigned")}</div></div></div></section>`;
      } else if (tab === "activity") {
        panel = `<section class="panel"><div class="panel-head"><h2>Activity</h2></div><div class="panel-body"><ul class="activity">${org.auditEvents.map((e) => `<li>${activityIcon(e.action)} <strong>${escapeHtml(e.action.replaceAll("_", " "))}</strong><div class="muted small">${dateTimeLabel(e.createdAt)} · ${escapeHtml(e.actorEmail)}</div>${e.detail ? `<div class="small">${escapeHtml(e.detail)}</div>` : ""}</li>`).join("") || "<li class=muted>No activity yet.</li>"}</ul></div></section>`;
      } else if (tab === "notes" || tab === "pipeline") {
        panel = `<div class="split"><section class="panel"><div class="panel-head"><h2>${isLead ? "Pipeline" : "Notes"}</h2></div><div class="panel-body">${isLead ? `<div class="stepper">${PIPELINE_STAGES.map((s) => `<div class="${PIPELINE_STAGES.indexOf(s as (typeof PIPELINE_STAGES)[number]) <= PIPELINE_STAGES.indexOf(org.pipelineStage as (typeof PIPELINE_STAGES)[number]) ? "on" : ""}">${badge(s)}</div>`).join("")}</div><form method="post" action="${input.basePath}/crm/${org.id}/stage" style="margin-top:16px">${csrfField(input.session)}<div class="field"><label>Move stage</label><select name="stage">${PIPELINE_STAGES.map((s) => `<option${s === org.pipelineStage ? " selected" : ""}>${s}</option>`).join("")}</select></div><button class="btn primary" style="margin-top:10px">Update pipeline</button></form>` : ""}<form method="post" action="${input.basePath}/crm/${org.id}/notes" style="margin-top:18px">${csrfField(input.session)}<div class="field"><label>Add note</label><textarea name="note" required></textarea></div><button class="btn" style="margin-top:8px">Save note</button></form><pre class="muted" style="white-space:pre-wrap;margin-top:16px">${escapeHtml(org.notes || "No notes yet.")}</pre></div></section><section class="panel"><div class="panel-head"><h2>Next action</h2></div><div class="panel-body stack"><div><strong>${escapeHtml(org.followUps.find((f) => f.status === "OPEN")?.title || "No open follow-up")}</strong><div class="muted small">${dateLabel(org.followUps.find((f) => f.status === "OPEN")?.dueOn)} · ${escapeHtml(org.assignedOwner || "Unassigned")}</div></div><form method="post" action="${input.basePath}/crm/${org.id}/demos">${csrfField(input.session)}<div class="field"><label>Schedule demo</label><input name="scheduledAt" type="datetime-local" required></div><button class="btn" style="margin-top:8px">Open demo</button></form><form method="post" action="${input.basePath}/crm/${org.id}/followups">${csrfField(input.session)}<div class="field"><label>Add follow-up</label><input name="title" required placeholder="Call principal"></div><div class="field"><label>Due</label><input name="dueOn" type="date" required></div><button class="btn" style="margin-top:8px">Add follow-up</button></form></div></section></div>`;
      } else {
        panel = `<div class="split"><div><section class="panel"><div class="panel-head"><h2>School information</h2></div><div class="panel-body form-grid"><div><span class="muted small">School name</span><strong>${escapeHtml(org.schoolName)}</strong></div><div><span class="muted small">Contact</span><strong>${escapeHtml(org.ownerName)}</strong></div><div><span class="muted small">Phone</span><div>${escapeHtml(org.ownerPhone)}</div></div><div><span class="muted small">Email</span><div>${escapeHtml(org.ownerEmail)}</div></div><div><span class="muted small">City</span><div>${escapeHtml(org.city || "—")}</div></div><div><span class="muted small">State</span><div>${escapeHtml(org.billingState || "—")}</div></div><div><span class="muted small">Students</span><div>${org.studentCount ?? "—"}</div></div><div><span class="muted small">Teachers</span><div>${org.teacherCount ?? "—"}</div></div><div><span class="muted small">Source</span><div>${escapeHtml(org.source.replaceAll("_", " "))}</div></div><div><span class="muted small">Interested in</span><div>${escapeHtml(org.interestedIn || "—")}</div></div></div></section><section class="panel"><div class="panel-head"><h2>Account status</h2></div><div class="panel-body form-grid"><div><span class="muted small">Subscription</span><div>${badge(org.subscriptionStatus)}</div></div><div><span class="muted small">Plan</span><div>${escapeHtml(org.plan)}</div></div><div><span class="muted small">Started</span><div>${dateLabel(org.subscriptionStart)}</div></div><div><span class="muted small">Expires</span><div>${dateLabel(org.renewalOn)}</div></div><div><span class="muted small">Onboarding</span><div>${pct}%</div></div><div><span class="muted small">Account manager</span><div>${escapeHtml(org.assignedOwner || "Unassigned")}</div></div></div></section></div><section class="panel"><div class="panel-head"><h2>Activity</h2></div><div class="panel-body"><ul class="activity">${org.auditEvents.slice(0, 8).map((e) => `<li>${activityIcon(e.action)} <strong>${escapeHtml(e.action.replaceAll("_", " "))}</strong><div class="muted small">${dateTimeLabel(e.createdAt)}</div></li>`).join("") || "<li class=muted>No activity yet.</li>"}</ul></div></section></div>`;
      }
      body = `${header}${panel}`;
    }
  } else if (view === "subscriptions") {
    body = `${pageHead("Subscriptions", "Plans live on the organisation. Changing plan does not create a new school.")}<section class="panel"><div class="table-wrap">${subscriptions.length ? `<table><thead><tr><th>School</th><th>Plan</th><th>Amount</th><th>Status</th><th>Renews</th></tr></thead><tbody>${subscriptions.map((s) => `<tr><td><a href="${baseUrl(input.basePath, { view: "org", id: s.orgId, tab: "subscription" })}">${escapeHtml(s.org.schoolName)}</a></td><td>${escapeHtml(s.plan)}</td><td class="num">${money(s.amount)}</td><td>${badge(s.status)}</td><td>${dateLabel(s.renewsAt)}</td></tr>`).join("")}</tbody></table>` : empty("No subscriptions", "Trials and paid plans appear here.")}</div></section>`;
  } else if (view === "new-invoice") {
    const org = await prisma.saasOrg.findUnique({ where: { id: input.id || "" } });
    const today = new Date();
    const due = new Date(today);
    due.setDate(due.getDate() + 7);
    body = org
      ? `${pageHead("Create invoice", `Draft a new invoice for ${org.schoolName}.`)}<section class="panel"><div class="panel-body"><form method="post" action="${input.basePath}/orgs/${encodeURIComponent(org.id)}/invoices">${csrfField(input.session)}<div class="form-grid"><div class="field"><label>Invoice date *</label><input name="issueDate" type="date" required value="${dateInput(today)}"></div><div class="field"><label>Due date *</label><input name="dueDate" type="date" required value="${dateInput(due)}"></div><div class="field full"><label>Description *</label><input name="description" required placeholder="Anekio school ERP subscription"></div><div class="field"><label>Quantity *</label><input name="quantity" type="number" min="1" required value="1"></div><div class="field"><label>Unit price (₹) *</label><input name="unitPrice" type="number" min="1" required value="${org.monthlyPrice || 14999}"></div><div class="field"><label>GST rate (%)</label><select name="taxPercent"><option value="0">No GST</option><option value="18" selected>18%</option></select></div><div class="field full"><label>Invoice note</label><textarea name="notes"></textarea></div></div><div class="form-actions"><a class="btn" href="${baseUrl(input.basePath, { view: "org", id: org.id, tab: "billing" })}">Cancel</a><button class="btn primary" type="submit">Save draft</button></div></form></div></section>`
      : pageHead("Organisation not found", "Choose an organisation before creating an invoice.");
  } else if (view === "invoice") {
    const invoice = await prisma.saasInvoice.findUnique({ where: { id: input.id || "" }, include: { org: true, payments: { orderBy: { createdAt: "desc" } } } });
    if (!invoice) body = pageHead("Invoice not found", "The requested invoice is unavailable.");
    else {
      const balance = invoice.total - invoice.paidAmount;
      body = `${pageHead(invoice.number, `${invoice.org.schoolName} · ${dateLabel(invoice.issueDate)}`, `<div class="actions"><a class="btn" target="_blank" href="${input.basePath}/invoices/${invoice.id}/print">Download invoice</a>${invoice.status === "DRAFT" ? `<form method="post" action="${input.basePath}/invoices/${invoice.id}/issue">${csrfField(input.session)}<button class="btn primary">Issue invoice</button></form>` : ""}</div>`)}<div class="split"><section class="panel"><div class="panel-head"><h2>Invoice</h2>${badge(invoice.status)}</div><div class="panel-body"><p><span class="muted">School</span><br><strong>${escapeHtml(invoice.org.schoolName)}</strong></p><p><span class="muted">Plan</span><br>${escapeHtml(invoice.description)}</p><div class="stack" style="width:min(320px,100%);margin-left:auto"><div style="display:flex;justify-content:space-between"><span class="muted">Subtotal</span><strong>${money(invoice.subtotal)}</strong></div><div style="display:flex;justify-content:space-between"><span class="muted">GST</span><strong>${money(invoice.taxAmount)}</strong></div><div style="display:flex;justify-content:space-between;font-size:18px"><span>Total</span><strong>${money(invoice.total)}</strong></div><div style="display:flex;justify-content:space-between"><span class="muted">Payment</span><strong>${badge(invoice.status)}</strong></div>${invoice.payments[0]?.paymentId ? `<div class="muted small">Transaction ${escapeHtml(invoice.payments[0].paymentId)}</div>` : ""}</div></div></section><div>${!["DRAFT", "PAID", "VOID"].includes(invoice.status) ? `<section class="panel" style="margin-top:0"><div class="panel-head"><h2>Record payment</h2></div><div class="panel-body"><form method="post" action="${input.basePath}/invoices/${invoice.id}/payments">${csrfField(input.session)}<div class="stack"><div class="field"><label>Amount (₹)</label><input name="amount" type="number" min="1" max="${balance}" required value="${balance}"></div><div class="field"><label>Payment date</label><input name="paidAt" type="date" required value="${dateInput(new Date())}"></div><div class="field"><label>Method</label><select name="method"><option>BANK_TRANSFER</option><option>UPI</option><option>RAZORPAY</option></select></div><div class="field"><label>Reference / UTR</label><input name="reference"></div><button class="btn primary" type="submit">Record payment</button></div></form></div></section>` : ""}<section class="panel"><div class="panel-head"><h2>Payments</h2></div>${invoice.payments.length ? `<div class="panel-body stack">${invoice.payments.map((p) => `<div><strong>${money(p.amount)}</strong> ${badge(p.status)}<div class="muted small">${dateLabel(p.paidAt)} · ${escapeHtml(p.provider)}</div></div>`).join("")}</div>` : empty("No payments", "Payments recorded against this invoice appear here.")}</section></div></div>`;
    }
  } else if (view === "invoices") {
    body = `${pageHead("Invoices", "Track draft, issued, paid, and overdue invoices.")}<section class="panel"><div class="table-wrap">${allInvoices.length ? `<table><thead><tr><th>Invoice</th><th>Organisation</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>${allInvoices.map((i) => `<tr><td><a href="${baseUrl(input.basePath, { view: "invoice", id: i.id })}"><strong>${escapeHtml(i.number)}</strong></a></td><td>${escapeHtml(i.org.schoolName)}</td><td>${dateLabel(i.issueDate)}</td><td class="num">${money(i.total)}</td><td>${badge(i.status)}</td></tr>`).join("")}</tbody></table>` : empty("No invoices", "Create an invoice from an organisation.")}</div></section>`;
  } else if (view === "payments") {
    const payments = await prisma.saasPayment.findMany({ orderBy: { createdAt: "desc" }, include: { org: true, invoice: true }, take: 100 });
    body = `${pageHead("Payments", "Online and manually received payments.")}<section class="panel"><div class="table-wrap">${payments.length ? `<table><thead><tr><th>Date</th><th>Organisation</th><th>Invoice</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead><tbody>${payments.map((p) => `<tr><td>${dateLabel(p.paidAt || p.createdAt)}</td><td>${escapeHtml(p.org.schoolName)}</td><td>${p.invoice ? `<a href="${baseUrl(input.basePath, { view: "invoice", id: p.invoice.id })}">${escapeHtml(p.invoice.number)}</a>` : "—"}</td><td>${escapeHtml(p.provider)}</td><td class="num"><strong>${money(p.amount)}</strong></td><td>${badge(p.status)}</td></tr>`).join("")}</tbody></table>` : empty("No payments", "Payments appear after checkout or manual recording.")}</div></section>`;
  } else if (view === "onboarding") {
    const queue = customers.filter((o) => o.onboardingStatus !== "COMPLETE");
    body = `${pageHead("Onboarding", "Payment success does not mean the school is live. This is the internal go-live queue.")}<section class="panel"><div class="table-wrap">${queue.length ? `<table><thead><tr><th>School</th><th>Progress</th><th>Manager</th><th>Status</th></tr></thead><tbody>${queue
      .map((o) => {
        const total = o.onboardingTasks.length || 8;
        const done = o.onboardingTasks.filter((t) => t.done).length;
        const pct = Math.round((done / total) * 100);
        return `<tr><td><a href="${baseUrl(input.basePath, { view: "org", id: o.id, tab: "onboarding" })}"><strong>${escapeHtml(o.schoolName)}</strong></a></td><td><div class="progress"><b style="width:${pct}%"></b></div><span class="small">${pct}%</span></td><td>${escapeHtml(o.assignedOwner || "Unassigned")}</td><td>${badge(o.onboardingStatus)}</td></tr>`;
      })
      .join("")}</tbody></table>` : empty("Queue is clear", "New customers land here automatically after payment.")}</div></section>`;
  } else if (view === "followups") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const tomorrow = new Date(start);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(start);
    dayAfter.setDate(dayAfter.getDate() + 2);
    const today = openFollowUps.filter((f) => f.dueOn < tomorrow);
    const next = openFollowUps.filter((f) => f.dueOn >= tomorrow && f.dueOn < dayAfter);
    const later = openFollowUps.filter((f) => f.dueOn >= dayAfter);
    const block = (title: string, cls: string, rows: typeof openFollowUps) =>
      `<section class="panel"><div class="panel-head"><h2 class="${cls}">${title}</h2></div>${rows.length ? `<div class="panel-body stack">${rows
        .map(
          (f) =>
            `<div><strong>${escapeHtml(f.org.schoolName)}</strong><div class="muted small">${escapeHtml(f.title)}</div><div>Next action: ${escapeHtml(f.nextAction || "Follow up")}</div><div class="actions" style="margin-top:8px"><a class="btn" href="tel:${escapeHtml(f.org.ownerPhone)}">Call</a><a class="btn" href="${baseUrl(input.basePath, { view: isCustomerOrg(f.org) ? "org" : "lead", id: f.orgId, tab: "notes" })}">Add note</a><form method="post" action="${input.basePath}/crm/followups/${f.id}/done">${csrfField(input.session)}<button class="btn">Done</button></form></div></div>`
        )
        .join("")}</div>` : empty("Nothing here", "Your follow-up queue is clear.")}</section>`;
    body = `${pageHead("Follow-ups", "Automatically created after demos, proposals, failed payments, and trial endings.")}${block("Today", "due-hot", today)}${block("Tomorrow", "due-soon", next)}${block("Later", "", later)}`;
  } else if (view === "support") {
    const tickets = await prisma.saasSupportTicket.findMany({ orderBy: { createdAt: "desc" }, include: { org: true }, take: 80 });
    body = `${pageHead("Support", "Internal tickets against customer organisations.")}<section class="panel"><div class="panel-body"><form method="post" action="${input.basePath}/crm/support" class="form-grid">${csrfField(input.session)}<div class="field"><label>Organisation</label><select name="orgId">${customers.map((o) => `<option value="${o.id}">${escapeHtml(o.schoolName)}</option>`).join("")}</select></div><div class="field"><label>Subject</label><input name="subject" required></div><div class="field full"><label>Details</label><textarea name="body"></textarea></div><div class="form-actions"><button class="btn primary">Open ticket</button></div></form></div></section><section class="panel"><div class="table-wrap">${tickets.length ? `<table><thead><tr><th>School</th><th>Subject</th><th>Status</th><th>Opened</th></tr></thead><tbody>${tickets.map((t) => `<tr><td>${escapeHtml(t.org.schoolName)}</td><td>${escapeHtml(t.subject)}</td><td>${badge(t.status)}</td><td>${dateLabel(t.createdAt)}</td></tr>`).join("")}</tbody></table>` : empty("No tickets", "Open a ticket for a customer school.")}</div></section>`;
  } else if (view === "pricing") {
    const p = await getSitePricing();
    body = `${pageHead("Landing page pricing", "Change list price and discount here. The public website and checkout update immediately.")}
      <section class="panel"><div class="panel-head"><h2>Public offer</h2>${badge(p.discountOn ? `${p.savePercent}% OFF` : "LIST PRICE")}</div>
      <div class="panel-body">
        <div class="form-grid" style="margin-bottom:18px">
          <div><span class="muted small">List price</span><strong style="display:block;font-size:26px">${money(p.listPrice)}</strong></div>
          <div><span class="muted small">Sale price on website</span><strong style="display:block;font-size:26px">${money(p.salePrice)}</strong></div>
          <div><span class="muted small">School saves</span><strong style="display:block;font-size:26px">${p.saveAmount ? money(p.saveAmount) : "—"}</strong></div>
          <div><span class="muted small">Trial</span><strong style="display:block;font-size:26px">${p.trialDays} days</strong></div>
        </div>
        <form method="post" action="${input.basePath}/settings/pricing">${csrfField(input.session)}
          <div class="form-grid">
            <div class="field"><label>Plan name</label><input name="planName" required value="${escapeHtml(p.planName)}" placeholder="Launch"></div>
            <div class="field"><label>Billing period</label><select name="billingPeriod"><option${p.billingPeriod === "year" ? " selected" : ""} value="year">Year</option><option${p.billingPeriod === "month" ? " selected" : ""} value="month">Month</option></select></div>
            <div class="field"><label>List price (₹)</label><input name="listPrice" type="number" min="0" required value="${p.listPrice}"></div>
            <div class="field"><label>Offer label</label><input name="offerLabel" value="${escapeHtml(p.offerLabel)}" placeholder="Early bird"></div>
            <div class="field"><label>Apply discount</label><select name="discountOn"><option value="true"${p.discountOn ? " selected" : ""}>Yes — show strike-through and savings</option><option value="false"${p.discountOn ? "" : " selected"}>No — show list price only</option></select></div>
            <div class="field"><label>Discount type</label><select name="discountType"><option value="AMOUNT"${p.discountType === "AMOUNT" ? " selected" : ""}>Rupees off</option><option value="PERCENT"${p.discountType === "PERCENT" ? " selected" : ""}>Percent off</option></select></div>
            <div class="field"><label>Discount value</label><input name="discountValue" type="number" min="0" required value="${p.discountValue}"><span class="muted small">₹ off, or % off the list price</span></div>
            <div class="field"><label>Free trial (days)</label><input name="trialDays" type="number" min="1" required value="${p.trialDays}"></div>
          </div>
          <div class="form-actions"><button class="btn primary" type="submit">Publish to landing page</button></div>
        </form>
      </div></section>`;
  } else {
    body = `${pageHead("Settings", "Security and portal configuration.")}<section class="panel"><div class="panel-body"><h3>Landing pricing</h3><p class="muted">Set list price, discount, and trial length from <a href="${baseUrl(input.basePath, { view: "pricing" })}"><strong>Billing → Pricing</strong></a>. Those values appear on the public website.</p><h3>Access policy</h3><p class="muted">Allowed: exact account <strong>buildtogether.tech@gmail.com</strong>, plus verified accounts at exactly <strong>anekio.com</strong> and <strong>anekio.in</strong>.</p><h3>Signed-in operator</h3><p>${escapeHtml(input.session.email)}</p><h3>Google OAuth</h3><p>${googleAdminAuthConfigured() ? badge("ACTIVE") : `${badge("CONFIGURATION_REQUIRED")} <span class="muted">Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.</span>`}</p></div></section>`;
  }

  return adminDocument({
    title: view === "dashboard" ? "Dashboard" : view.replaceAll("-", " "),
    basePath: input.basePath,
    session: input.session,
    view,
    body,
    flash: input.flash,
    error: input.error,
  });
}

export async function adminInvoicePrintHtml(id: string) {
  const invoice = await prisma.saasInvoice.findUnique({ where: { id }, include: { org: true } });
  if (!invoice) return null;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(invoice.number)}</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:0}.invoice{max-width:820px;margin:30px auto;padding:40px;border:1px solid #ddd}.head,.row{display:flex;justify-content:space-between;gap:30px}.brand{font-size:26px;font-weight:800}.muted{color:#667085}.box{margin:30px 0;padding:20px;background:#f8fafc}.line{width:100%;border-collapse:collapse;margin-top:30px}.line th,.line td{padding:12px;border-bottom:1px solid #ddd;text-align:left}.line th:last-child,.line td:last-child{text-align:right}.totals{width:320px;margin:30px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:7px}.total{font-size:20px;font-weight:800;border-top:2px solid #172033}@media print{.invoice{border:0;margin:0;max-width:none}.no-print{display:none}}</style></head><body><main class="invoice"><button class="no-print" onclick="print()">Print / Save PDF</button><div class="head"><div><div class="brand">Anekio</div><div class="muted">Anekio SaaS</div></div><div><h1>INVOICE</h1><strong>${escapeHtml(invoice.number)}</strong></div></div><div class="box row"><div><span class="muted">BILL TO</span><h3>${escapeHtml(invoice.org.schoolName)}</h3><div>${escapeHtml(invoice.org.billingAddress || invoice.org.city)}<br>${escapeHtml(invoice.org.ownerEmail)}</div></div><div><span class="muted">INVOICE DATE</span><p>${dateLabel(invoice.issueDate)}</p><span class="muted">DUE DATE</span><p>${dateLabel(invoice.dueDate)}</p></div></div><table class="line"><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Tax</th><th>Amount</th></tr></thead><tbody><tr><td>${escapeHtml(invoice.description)}</td><td>${invoice.quantity}</td><td>${money(invoice.unitPrice)}</td><td>${invoice.taxPercent}%</td><td>${money(invoice.total)}</td></tr></tbody></table><div class="totals"><div><span>Subtotal</span><span>${money(invoice.subtotal)}</span></div><div><span>GST</span><span>${money(invoice.taxAmount)}</span></div><div class="total"><span>Total</span><span>${money(invoice.total)}</span></div></div></main></body></html>`;
}
