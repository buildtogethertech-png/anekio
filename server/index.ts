import "dotenv/config";
import cors from "cors";
import express from "express";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import bcrypt from "bcryptjs";
import { signAppToken } from "../lib/app-jwt";
import {
  AuthFlowError,
  consumeAuthCode,
  requestAuthCode,
  resetPasswordWithCode,
} from "../lib/auth-challenges";
import { hasAny, userFromAuthHeader } from "../lib/http-user";
import { userForLogin } from "../lib/login";
import { serializeUser } from "../lib/http-user";
import { publicNav, navForPortal } from "../lib/nav";
import { recordPayload } from "../lib/api-v1-record";
import { queryFeeRegister } from "../lib/fee-register";
import { homePayload, serializeNotice } from "../lib/api-v1-home";
import { noticesForUser } from "../lib/data";
import { runAct } from "../lib/run-act";
import {
  completePresignedFileUpload,
  handleFileUpload,
  preparePresignedFileUpload,
} from "../lib/handle-upload";
import { presignedReadUrl, readUpload, readUploadDataUrl, resolveUploadPath } from "../lib/uploads";
import { gatewayReady, getSchoolPaySecrets } from "../lib/pay-config";
import { createSchoolFeeOrder, verifySchoolPayment, invoicesFromPeriods } from "../lib/pay";
import { batchDocumentsHtml, findBatchDocuments, findIssuedDocument, verificationHtml } from "../lib/document-studio";
import { prisma } from "../lib/prisma";
import { verifyCashfreeWebhook, captureCashfreePayment } from "../lib/cashfree";
import { captureRazorpayPayment, captureRazorpayMonths, verifyWebhookSignature } from "../lib/razorpay";
import { issueDueFeesCore } from "../lib/fee-run";
import { marksheetHtmlForUser } from "../lib/marksheet-html";
import { runExamCronNotifications } from "../lib/exam-notification-run";
import { ensureAccessRoles } from "../lib/roles";
import { scopePolicyFor } from "../lib/permissions";
import { onboardingTemplate } from "../lib/onboarding";
import { withPublicRequestOrigin } from "../lib/utils";
import { hasHostnamePrefix, normalizeHostname, schoolSlugFromHostname } from "../lib/host-routing";
import { renderInvoicePage, renderPayPage, renderStudentPayPage } from "./pay-html";
import {
  createAdmissionLeadFromWebsite,
  prepareAdmissionFileUpload,
  schoolWebsiteHtml,
} from "../lib/school-website";
import {
  createSaasDemoEnquiry,
  createSaasEnquiry,
  createSaasRazorpayOrder,
  createSaasTrial,
  marketingHtml,
  robotsTxt,
  saasRenewalHtml,
  saasCheckoutHtml,
  sitemapXml,
  subscriptionLockForUser,
  subscriptionOverviewForUser,
  trialStartedHtml,
  verifySaasRazorpayPayment,
} from "../lib/anekio-site";
import {
  adminInvoicePrintHtml,
  adminLoginHtml,
  adminPortalHtml,
  createAdminInvoice,
  createAdminOrganisation,
  issueAdminInvoice,
  recordAdminPayment,
  runAdminCrmAction,
  saveSaasEmailConfig,
  saveSaasEmailRule,
  updateAdminOrganisation,
} from "../lib/saas-admin";
import { adminInvoicePdf } from "../lib/saas-invoice-pdf";
import { sendSaasEmailEvent } from "../lib/saas-email";
import { updateSitePricing } from "../lib/saas-pricing";
import {
  ADMIN_OAUTH_COOKIE,
  ADMIN_SESSION_COOKIE,
  clearCookie,
  cookieValue,
  createAdminSession,
  createGoogleAdminAuth,
  finishGoogleAdminAuth,
  readAdminSession,
  secureRequest,
  verifyLocalAdminLogin,
} from "../lib/saas-admin-auth";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const PORT = Number(process.env.PORT || 4000);
const serverDir =
  typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const argvRoot = process.argv[1] ? path.resolve(path.dirname(process.argv[1]), "..") : "";
const appShellRoutes = [
  "/login",
  "/notices",
  "/notifications",
  "/inbox",
  "/more",
  "/people",
  "/onboarding",
  "/admissions",
  "/staff",
  "/school",
  "/timetable",
  "/fees",
  "/exams",
  "/roles",
  "/attendance",
  "/class",
  "/leave",
  "/subjects",
  "/tests",
  "/papers",
  "/path",
  "/letter",
  "/uploads",
  "/profile",
];

app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type"],
  })
);
app.use("/api/pay/webhook", express.raw({ type: "*/*" }));
app.use("/api/razorpay/webhook", express.raw({ type: "*/*" }));
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => withPublicRequestOrigin(requestOrigin(req), next));

function sendError(res: express.Response, status: number, error: string) {
  res.status(status).json({ error });
}

const PUBLIC_DEMO_RATE_WINDOW_MS = 10 * 60_000;
const PUBLIC_DEMO_RATE_MAX = 6;
const publicDemoAttempts = new Map<string, number[]>();

function publicDemoRequestKey(req: express.Request) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

/** A small process-local backstop; the honeypot and delivery idempotency cover the rest. */
function allowPublicDemoRequest(req: express.Request) {
  const now = Date.now();
  const key = publicDemoRequestKey(req);
  const recent = (publicDemoAttempts.get(key) || []).filter((attempt) => attempt > now - PUBLIC_DEMO_RATE_WINDOW_MS);
  if (recent.length >= PUBLIC_DEMO_RATE_MAX) return false;
  recent.push(now);
  publicDemoAttempts.set(key, recent);
  if (publicDemoAttempts.size > 2_000) {
    for (const [candidate, attempts] of publicDemoAttempts) {
      if (!attempts.some((attempt) => attempt > now - PUBLIC_DEMO_RATE_WINDOW_MS)) publicDemoAttempts.delete(candidate);
    }
  }
  return true;
}

function hostName(req: express.Request) {
  return normalizeHostname(String(req.headers["x-forwarded-host"] || req.headers.host || ""));
}

function isAdminHost(req: express.Request) {
  return hasHostnamePrefix(hostName(req), "admin");
}

function adminBase(req: express.Request) {
  return isAdminHost(req) ? "" : "/anekio-admin";
}

function requestOrigin(req: express.Request) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol;
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost:4000").split(",")[0].trim();
  return `${protocol}://${host}`;
}

function adminSecureCookie(req: express.Request) {
  return secureRequest({
    protocol: req.protocol,
    forwardedProto: String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim(),
  });
}

function adminSession(req: express.Request) {
  try {
    return readAdminSession(req.headers.cookie);
  } catch {
    return null;
  }
}

function adminCsrf(req: express.Request, csrf: string) {
  const provided = String(req.body?.csrf || "");
  return provided.length === csrf.length && provided === csrf;
}

function isAppHost(req: express.Request) {
  return hasHostnamePrefix(hostName(req), "app");
}

function isConnectHost(req: express.Request) {
  return hasHostnamePrefix(hostName(req), "connect");
}

function schoolSlugHost(req: express.Request) {
  return schoolSlugFromHostname(hostName(req));
}

async function requireUser(req: express.Request, res: express.Response) {
  const user = await userFromAuthHeader(req.headers.authorization);
  if (!user) {
    sendError(res, 401, "Sign in again.");
    return null;
  }
  return user;
}

async function requireActiveSubscription(userId: string, res: express.Response) {
  const lock = await subscriptionLockForUser(userId);
  if (!lock) return true;
  sendError(res, 402, "Renew Anekio to continue.");
  return false;
}

type LoginRow = NonNullable<Awaited<ReturnType<typeof userForLogin>>>;

function loginSession(row: LoginRow) {
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role.slug,
    roleName: row.role.name,
    roleId: row.roleId,
    portal: row.role.portal,
    permissions: row.role.grants.map((grant) => grant.permission),
    scopes: Object.fromEntries(
      row.role.grants.map((grant) => [grant.permission, grant.scope ?? scopePolicyFor(grant.permission, row.role.portal).defaultScope])
    ),
    isSystemRole: row.role.isSystem,
  };
  return {
    token: signAppToken(row.id),
    user: serializeUser(user),
    nav: navForPortal(user.portal, user.permissions).map(publicNav),
  };
}

function sendAuthFlowError(res: express.Response, error: unknown) {
  if (error instanceof AuthFlowError) return sendError(res, error.status, error.message);
  console.error("Authentication flow failed", error);
  return sendError(res, 500, "Secure sign-in is temporarily unavailable.");
}

app.post("/api/v1/login", async (req, res) => {
  const login = String(req.body?.login || "").trim();
  const password = String(req.body?.password || "");
  if (!login || !password) return sendError(res, 400, "Email or number, and password.");
  await ensureAccessRoles();
  const row = await userForLogin(login);
  if (!row?.role) return sendError(res, 401, "Those credentials are not in this school.");
  const ok = await bcrypt.compare(password, row.password);
  if (!ok) return sendError(res, 401, "Those credentials are not in this school.");
  res.json(loginSession(row));
});

app.post("/api/v1/login/otp/request", async (req, res) => {
  try {
    res.json(await requestAuthCode(String(req.body?.login || ""), "LOGIN"));
  } catch (error) {
    sendAuthFlowError(res, error);
  }
});

app.post("/api/v1/login/otp/verify", async (req, res) => {
  try {
    await ensureAccessRoles();
    const userId = await consumeAuthCode(String(req.body?.login || ""), "LOGIN", String(req.body?.code || ""));
    const row = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: { include: { grants: true } } },
    });
    if (!row?.role) return sendError(res, 401, "That code is invalid or has expired.");
    res.json(loginSession(row));
  } catch (error) {
    sendAuthFlowError(res, error);
  }
});

app.post("/api/v1/login/password/request", async (req, res) => {
  try {
    res.json(await requestAuthCode(String(req.body?.login || ""), "PASSWORD_RESET"));
  } catch (error) {
    sendAuthFlowError(res, error);
  }
});

app.post("/api/v1/login/password/reset", async (req, res) => {
  try {
    res.json(
      await resetPasswordWithCode(
        String(req.body?.login || ""),
        String(req.body?.code || ""),
        String(req.body?.password || "")
      )
    );
  } catch (error) {
    sendAuthFlowError(res, error);
  }
});

app.get("/api/v1/me", async (req, res) => {
  await ensureAccessRoles();
  const user = await requireUser(req, res);
  if (!user) return;
  res.json({
    user: serializeUser(user),
    nav: navForPortal(user.portal, user.permissions).map(publicNav),
  });
});

app.get("/api/v1/marksheet", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const html = await marksheetHtmlForUser(user, {
      seriesId: String(req.query.seriesId || ""),
      examId: String(req.query.examId || ""),
      studentId: String(req.query.studentId || ""),
    });
    res.type("html").send(html);
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Marksheet unavailable");
  }
});

app.get("/api/v1/fee-register", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireActiveSubscription(user.id, res))) return;
  if (!hasAny(user, ["fees.view"])) return sendError(res, 403, "No access.");
  try {
    res.json(await queryFeeRegister(user, (req.query || {}) as Record<string, unknown>));
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Fee register unavailable");
  }
});

app.get("/api/v1/record", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const allowed = hasAny(user, [
    "children.view",
    "self.view",
    "attendance.mark",
    "desk.view",
    "people.view",
    "onboarding.manage",
    "staff.view",
    "fees.view",
    "exams.view",
    "school.edit",
    "roles.manage",
    "timetable.view",
    "exams.teach",
    "papers.upload",
    "timetable.teach",
  ]);
  if (!allowed) return sendError(res, 403, "No access.");
  res.json(await recordPayload(user, typeof req.query.childId === "string" ? req.query.childId : null));
});

app.get("/api/v1/onboarding/template", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireActiveSubscription(user.id, res))) return;
  try {
    const template = await onboardingTemplate(user, String(req.query.kind || ""));
    res.setHeader("Content-Type", template.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${template.fileName}"`);
    res.send(template.buffer);
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Template unavailable");
  }
});

app.get("/api/v1/subscription/invoices/:id/print", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const overview = await subscriptionOverviewForUser(user.id);
  if (!overview?.invoices.some((invoice) => invoice.id === String(req.params.id || ""))) {
    return sendError(res, 404, "Invoice not found.");
  }
  const pdf = await adminInvoicePdf(String(req.params.id || ""));
  if (!pdf) return sendError(res, 404, "Invoice not found.");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${pdf.filename}"`);
  res.send(pdf.buffer);
});

app.get("/api/v1/home", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireActiveSubscription(user.id, res))) return;
  res.json(await homePayload(user, typeof req.query.childId === "string" ? req.query.childId : null));
});

app.get("/api/v1/notices", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireActiveSubscription(user.id, res))) return;
  const notices = await noticesForUser(user);
  if (!hasAny(user, ["notices.view", "children.view", "attendance.mark", "self.view"])) {
    const exactNotices = notices.filter((notice) => notice.recipients.length > 0);
    if (!exactNotices.length) return sendError(res, 403, "No access.");
    return res.json({ notices: exactNotices.map(serializeNotice) });
  }
  res.json({ notices: notices.map(serializeNotice) });
});

app.post("/api/v1/act", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireActiveSubscription(user.id, res))) return;
  try {
    res.json(await runAct(user, (req.body || {}) as Record<string, unknown>));
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Could not save.");
  }
});

app.post("/api/v1/late-timing", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireActiveSubscription(user.id, res))) return;
  try {
    res.json(await runAct(user, { ...(req.body || {}), op: "saveSchoolPayrollRules" }));
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Could not save.");
  }
});

app.post("/api/files", upload.single("file"), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireActiveSubscription(user.id, res))) return;
  const file = req.file;
  if (!file?.buffer) return sendError(res, 400, "File required");
  try {
    const result = await handleFileUpload(
      user,
      { buf: file.buffer, name: file.originalname, mime: file.mimetype },
      (req.body || {}) as Record<string, string>
    );
    res.json({ ok: true, ...result });
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Upload failed");
  }
});

app.post("/api/files/presign", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireActiveSubscription(user.id, res))) return;
  const body = (req.body || {}) as Record<string, unknown>;
  const fields = body.fields && typeof body.fields === "object"
    ? body.fields as Record<string, unknown>
    : {};
  try {
    res.json(await preparePresignedFileUpload(
      user,
      {
        name: String(body.fileName || ""),
        mime: String(body.fileType || "application/octet-stream"),
        size: Number(body.fileSize || 0),
      },
      fields
    ));
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Could not prepare upload");
  }
});

app.post("/api/files/complete", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await requireActiveSubscription(user.id, res))) return;
  try {
    res.json({ ok: true, ...await completePresignedFileUpload(user, String(req.body?.completionToken || "")) });
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Could not complete upload");
  }
});

app.post("/api/files/view-url", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const rel = String(req.body?.path || "").replace(/^\/+/, "");
  try {
    resolveUploadPath(rel);
    const directUrl = await presignedReadUrl(rel);
    res.json({ url: directUrl || await readUploadDataUrl(rel) });
  } catch (e) {
    sendError(res, 404, e instanceof Error ? e.message : "File not found");
  }
});

app.get("/api/files/*rel", async (req, res) => {
  const param = req.params.rel;
  const rel = decodeURIComponent(Array.isArray(param) ? param.join("/") : String(param || ""));
  try {
    const { publicFile } = resolveUploadPath(rel);
    if (!publicFile) {
      const user = await userFromAuthHeader(req.headers.authorization);
      if (!user) return sendError(res, 401, "Unauthorized");
    }
    const directUrl = await presignedReadUrl(rel);
    if (directUrl) return res.redirect(302, directUrl);
    const { buf, type } = await readUpload(rel);
    res.setHeader("Content-Type", type);
    res.send(buf);
  } catch {
    sendError(res, 404, "Not found");
  }
});

app.get("/school/:slug", async (req, res) => {
  const html = await schoolWebsiteHtml(String(req.params.slug || ""), { preview: req.query.preview === "1" });
  if (!html) return sendError(res, 404, "School website not found");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.post("/school/:slug/upload/presign", async (req, res) => {
  try {
    res.json(await prepareAdmissionFileUpload(String(req.params.slug || ""), (req.body || {}) as Record<string, unknown>));
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Could not prepare admission upload.");
  }
});

app.post("/school/:slug/lead", upload.any(), async (req, res) => {
  try {
    await createAdmissionLeadFromWebsite(String(req.params.slug || ""), req.body || {}, Array.isArray(req.files) ? req.files : []);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enquiry sent</title><style>body{margin:0;background:#f5f8fc;font-family:Arial,sans-serif;color:#102a43}.card{max-width:520px;margin:12vh auto;background:white;border:1px solid #d9e2ec;border-radius:20px;padding:28px;text-align:center}a{display:inline-block;margin-top:16px;color:#1d4ed8;font-weight:700}</style></head><body><main class="card"><h1>Enquiry sent</h1><p>Thank you. The school office will contact you soon.</p><a href="/school/${encodeURIComponent(String(req.params.slug || ""))}">Back to school website</a></main></body></html>`);
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Could not send enquiry.");
  }
});

async function renderAdminPage(req: express.Request, res: express.Response) {
  const basePath = adminBase(req);
  const session = adminSession(req);
  if (!session) {
    return res.type("html").send(adminLoginHtml(basePath, String(req.query.authError || "")));
  }
  return res.type("html").send(
    await adminPortalHtml({
      basePath,
      session,
      view: typeof req.query.view === "string" ? req.query.view : "dashboard",
      id: typeof req.query.id === "string" ? req.query.id : "",
      q: typeof req.query.q === "string" ? req.query.q.trim() : "",
      tab: typeof req.query.tab === "string" ? req.query.tab : "",
      flash: typeof req.query.saved === "string" ? req.query.saved : "",
      error: typeof req.query.error === "string" ? req.query.error : "",
    })
  );
}

function adminRouteRequest(req: express.Request) {
  return isAdminHost(req) || req.path === "/anekio-admin" || req.path.startsWith("/anekio-admin/");
}

function requireAdminAction(req: express.Request, res: express.Response) {
  const session = adminSession(req);
  const basePath = adminBase(req);
  if (!session) {
    res.redirect(303, basePath || "/");
    return null;
  }
  if (!adminCsrf(req, session.csrf)) {
    res.status(403).type("html").send(adminLoginHtml(basePath, "The form expired. Refresh the page and try again."));
    return null;
  }
  return session;
}

app.post(["/login", "/anekio-admin/login"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  const basePath = adminBase(req);
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!verifyLocalAdminLogin(email, password)) {
    return res.redirect(303, `${basePath || "/"}?authError=${encodeURIComponent("Those local test credentials are not authorised.")}`);
  }
  res.setHeader(
    "Set-Cookie",
    cookieValue(ADMIN_SESSION_COOKIE, createAdminSession(email), {
      secure: adminSecureCookie(req),
      maxAgeSeconds: 60 * 60 * 12,
    })
  );
  res.redirect(303, basePath || "/");
});

app.get(["/auth/google", "/anekio-admin/auth/google"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  try {
    const basePath = adminBase(req);
    const redirectUri = `${requestOrigin(req)}${basePath}/auth/google/callback`;
    const auth = createGoogleAdminAuth(redirectUri, basePath);
    res.setHeader("Set-Cookie", cookieValue(ADMIN_OAUTH_COOKIE, auth.cookie, { secure: adminSecureCookie(req), maxAgeSeconds: 600 }));
    res.redirect(302, auth.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in is unavailable.";
    res.redirect(302, `${adminBase(req) || "/"}?authError=${encodeURIComponent(message)}`);
  }
});

app.get(["/auth/google/callback", "/anekio-admin/auth/google/callback"], async (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  const basePath = adminBase(req);
  try {
    const profile = await finishGoogleAdminAuth({
      cookieHeader: req.headers.cookie,
      state: String(req.query.state || ""),
      code: String(req.query.code || ""),
    });
    res.setHeader("Set-Cookie", [
      cookieValue(ADMIN_SESSION_COOKIE, createAdminSession(profile.email), { secure: adminSecureCookie(req), maxAgeSeconds: 60 * 60 * 12 }),
      clearCookie(ADMIN_OAUTH_COOKIE, adminSecureCookie(req)),
    ]);
    res.redirect(303, profile.basePath || "/");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in could not be completed.";
    res.setHeader("Set-Cookie", clearCookie(ADMIN_OAUTH_COOKIE, adminSecureCookie(req)));
    res.redirect(303, `${basePath || "/"}?authError=${encodeURIComponent(message)}`);
  }
});

app.get(["/logout", "/anekio-admin/logout"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  res.setHeader("Set-Cookie", clearCookie(ADMIN_SESSION_COOKIE, adminSecureCookie(req)));
  res.redirect(303, adminBase(req) || "/");
});

app.get("/", async (req, res, next) => {
  if (isAdminHost(req)) return renderAdminPage(req, res);
  if (isAppHost(req) || isConnectHost(req)) return next();
  const slug = schoolSlugHost(req);
  if (slug) {
    const html = await schoolWebsiteHtml(slug);
    if (html) return res.type("html").send(html);
    return sendError(res, 404, "School website not found");
  }
  res.type("html").send(await marketingHtml());
});

app.get(["/features", "/pricing"], async (_req, res) => {
  res.type("html").send(await marketingHtml());
});

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send(robotsTxt());
});

app.get("/sitemap.xml", (_req, res) => {
  res.type("application/xml").send(sitemapXml());
});

app.get("/anekio/enquiry", async (_req, res) => {
  res.type("html").send(await marketingHtml());
});

app.post("/anekio/enquiry", async (req, res) => {
  try {
    await createSaasEnquiry(req.body || {});
    res.type("html").send(await marketingHtml("Thanks — enquiry saved. We will follow up with the school owner."));
  } catch (e) {
    res.status(400).type("html").send(await marketingHtml(e instanceof Error ? e.message : "Could not save enquiry."));
  }
});

app.get("/anekio-admin", renderAdminPage);

app.post("/orgs", async (req, res, next) => {
  if (!isAdminHost(req)) return next();
  const session = requireAdminAction(req, res);
  if (!session) return;
  try {
    const org = await createAdminOrganisation(req.body || {}, session.email);
    res.redirect(303, `/?view=org&id=${encodeURIComponent(org.id)}&saved=${encodeURIComponent("Organisation added.")}`);
  } catch (e) {
    res.redirect(303, `/?view=new-org&error=${encodeURIComponent(e instanceof Error ? e.message : "Could not add organisation.")}`);
  }
});

app.post("/orgs/:id", async (req, res, next) => {
  if (!isAdminHost(req)) return next();
  const session = requireAdminAction(req, res);
  if (!session) return;
  try {
    const org = await updateAdminOrganisation(String(req.params.id || ""), req.body || {}, session.email);
    res.redirect(303, `/?view=org&id=${encodeURIComponent(org.id)}&saved=${encodeURIComponent("Organisation updated.")}`);
  } catch (e) {
    res.redirect(303, `/?view=edit-org&id=${encodeURIComponent(String(req.params.id || ""))}&error=${encodeURIComponent(e instanceof Error ? e.message : "Could not update organisation.")}`);
  }
});

app.post("/anekio-admin/orgs", async (req, res) => {
  const session = requireAdminAction(req, res);
  if (!session) return;
  try {
    const org = await createAdminOrganisation(req.body || {}, session.email);
    res.redirect(303, `/anekio-admin?view=org&id=${encodeURIComponent(org.id)}&saved=${encodeURIComponent("Organisation added.")}`);
  } catch (e) {
    res.redirect(303, `/anekio-admin?view=new-org&error=${encodeURIComponent(e instanceof Error ? e.message : "Could not add organisation.")}`);
  }
});

app.post("/anekio-admin/orgs/:id", async (req, res) => {
  const session = requireAdminAction(req, res);
  if (!session) return;
  try {
    const org = await updateAdminOrganisation(String(req.params.id || ""), req.body || {}, session.email);
    res.redirect(303, `/anekio-admin?view=org&id=${encodeURIComponent(org.id)}&saved=${encodeURIComponent("Organisation updated.")}`);
  } catch (e) {
    res.redirect(303, `/anekio-admin?view=edit-org&id=${encodeURIComponent(String(req.params.id || ""))}&error=${encodeURIComponent(e instanceof Error ? e.message : "Could not update organisation.")}`);
  }
});

app.post(["/orgs/:id/invoices", "/anekio-admin/orgs/:id/invoices"], async (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  const session = requireAdminAction(req, res);
  if (!session) return;
  const basePath = adminBase(req);
  try {
    const invoice = await createAdminInvoice(String(req.params.id || ""), req.body || {}, session.email);
    res.redirect(303, `${basePath || "/"}?view=invoice&id=${encodeURIComponent(invoice.id)}&saved=${encodeURIComponent("Invoice draft created.")}`);
  } catch (e) {
    res.redirect(303, `${basePath || "/"}?view=new-invoice&id=${encodeURIComponent(String(req.params.id || ""))}&error=${encodeURIComponent(e instanceof Error ? e.message : "Could not create invoice.")}`);
  }
});

app.post(["/invoices/:id/issue", "/anekio-admin/invoices/:id/issue"], async (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  const session = requireAdminAction(req, res);
  if (!session) return;
  const basePath = adminBase(req);
  try {
    const invoice = await issueAdminInvoice(String(req.params.id || ""), session.email);
    res.redirect(303, `${basePath || "/"}?view=invoice&id=${encodeURIComponent(invoice.id)}&saved=${encodeURIComponent("Invoice issued.")}`);
  } catch (e) {
    res.redirect(303, `${basePath || "/"}?view=invoice&id=${encodeURIComponent(String(req.params.id || ""))}&error=${encodeURIComponent(e instanceof Error ? e.message : "Could not issue invoice.")}`);
  }
});

app.post(["/invoices/:id/payments", "/anekio-admin/invoices/:id/payments"], async (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  const session = requireAdminAction(req, res);
  if (!session) return;
  const basePath = adminBase(req);
  try {
    await recordAdminPayment(String(req.params.id || ""), req.body || {}, session.email);
    res.redirect(303, `${basePath || "/"}?view=invoice&id=${encodeURIComponent(String(req.params.id || ""))}&saved=${encodeURIComponent("Payment recorded.")}`);
  } catch (e) {
    res.redirect(303, `${basePath || "/"}?view=invoice&id=${encodeURIComponent(String(req.params.id || ""))}&error=${encodeURIComponent(e instanceof Error ? e.message : "Could not record payment.")}`);
  }
});

app.get(["/invoices/:id/print", "/anekio-admin/invoices/:id/print"], async (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  if (!adminSession(req)) return res.redirect(303, adminBase(req) || "/");
  const html = await adminInvoicePrintHtml(String(req.params.id || ""));
  if (!html) return res.status(404).send("Invoice not found");
  res.type("html").send(html);
});

app.post(["/settings/pricing", "/anekio-admin/settings/pricing"], async (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  const session = requireAdminAction(req, res);
  if (!session) return;
  const basePath = adminBase(req);
  try {
    await updateSitePricing(req.body || {}, session.email);
    res.redirect(303, `${basePath || "/"}?view=pricing&saved=${encodeURIComponent("Landing page pricing published.")}`);
  } catch (e) {
    res.redirect(303, `${basePath || "/"}?view=pricing&error=${encodeURIComponent(e instanceof Error ? e.message : "Could not save pricing.")}`);
  }
});

app.post(["/settings/email", "/anekio-admin/settings/email"], async (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  const session = requireAdminAction(req, res);
  if (!session) return;
  const basePath = adminBase(req);
  try {
    await saveSaasEmailConfig(req.body || {}, session.email);
    res.redirect(303, `${basePath || "/"}?view=email&saved=${encodeURIComponent("Email delivery profile saved.")}`);
  } catch (e) {
    res.redirect(303, `${basePath || "/"}?view=email&error=${encodeURIComponent(e instanceof Error ? e.message : "Could not save email delivery settings.")}`);
  }
});

app.post(["/settings/email/rules", "/anekio-admin/settings/email/rules"], async (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  const session = requireAdminAction(req, res);
  if (!session) return;
  const basePath = adminBase(req);
  try {
    await saveSaasEmailRule(req.body || {}, session.email);
    res.redirect(303, `${basePath || "/"}?view=email&saved=${encodeURIComponent("Demo email message saved.")}`);
  } catch (e) {
    res.redirect(303, `${basePath || "/"}?view=email&error=${encodeURIComponent(e instanceof Error ? e.message : "Could not save demo email message.")}`);
  }
});

function crmBack(req: express.Request, basePath: string, extra: Record<string, string> = {}) {
  const referer = String(req.get("referer") || "");
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.hostname === String(req.headers.host || "").split(":")[0] || url.hostname.endsWith("localhost")) {
        for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
        return `${url.pathname}${url.search}`;
      }
    } catch {
      /* ignore */
    }
  }
  const url = new URL(basePath || "/", "http://admin.local");
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

async function handleCrm(req: express.Request, res: express.Response, kind: string, id: string, extraInput: Record<string, unknown> = {}) {
  const session = requireAdminAction(req, res);
  if (!session) return;
  const basePath = adminBase(req);
  try {
    await runAdminCrmAction(kind, id, { ...(req.body || {}), ...extraInput }, session.email);
    res.redirect(303, crmBack(req, basePath, { saved: "Saved." }));
  } catch (e) {
    res.redirect(303, crmBack(req, basePath, { error: e instanceof Error ? e.message : "Could not save." }));
  }
}

app.post(["/crm/support", "/anekio-admin/crm/support"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  return handleCrm(req, res, "support", String(req.body?.orgId || ""));
});
app.post(["/crm/demos/:id/complete", "/anekio-admin/crm/demos/:id/complete"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  return handleCrm(req, res, "demo-complete", String(req.params.id || ""));
});
app.post(["/crm/followups/:id/done", "/anekio-admin/crm/followups/:id/done"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  return handleCrm(req, res, "followup-done", String(req.params.id || ""));
});
app.post(["/crm/:id/stage", "/anekio-admin/crm/:id/stage"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  return handleCrm(req, res, "stage", String(req.params.id || ""));
});
app.post(["/crm/:id/notes", "/anekio-admin/crm/:id/notes"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  return handleCrm(req, res, "notes", String(req.params.id || ""));
});
app.post(["/crm/:id/demos", "/anekio-admin/crm/:id/demos"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  return handleCrm(req, res, "demos", String(req.params.id || ""));
});
app.post(["/crm/:id/followups", "/anekio-admin/crm/:id/followups"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  return handleCrm(req, res, "followups", String(req.params.id || ""));
});
app.post(["/crm/:id/onboarding/start", "/anekio-admin/crm/:id/onboarding/start"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  return handleCrm(req, res, "onboarding-start", String(req.params.id || ""));
});
app.post(["/crm/:id/onboarding/:key", "/anekio-admin/crm/:id/onboarding/:key"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  return handleCrm(req, res, "onboarding-toggle", String(req.params.id || ""), { key: String(req.params.key || "") });
});
app.post(["/crm/:id/plan", "/anekio-admin/crm/:id/plan"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  return handleCrm(req, res, "plan", String(req.params.id || ""));
});
app.post(["/crm/:id/cancel", "/anekio-admin/crm/:id/cancel"], (req, res, next) => {
  if (!adminRouteRequest(req)) return next();
  return handleCrm(req, res, "cancel", String(req.params.id || ""));
});

app.post("/api/saas/enquiry", async (req, res) => {
  try {
    // The public form has an off-screen honeypot. A successful no-op prevents
    // bots from learning that they were detected and keeps them out of CRM/mail.
    if (String(req.body?.website || "").trim()) return res.json({ ok: true });
    if (!allowPublicDemoRequest(req)) return sendError(res, 429, "Please wait a few minutes before booking another demo.");

    const booking = await createSaasDemoEnquiry(req.body || {});
    if (!booking) return res.json({ ok: true });

    const leadUrl = `${requestOrigin(req).replace(/\/$/, "")}/anekio-admin?view=lead&id=${encodeURIComponent(booking.org.id)}`;
    try {
      await sendSaasEmailEvent({
        event: "DEMO_BOOKED",
        orgId: booking.org.id,
        idempotencyKey: `demo:${booking.org.id}:${booking.demo.scheduledAt.toISOString()}`,
        host: hostName(req),
        variables: {
          schoolName: booking.org.schoolName,
          ownerName: booking.org.ownerName,
          ownerEmail: booking.org.ownerEmail,
          ownerPhone: booking.org.ownerPhone,
          city: booking.org.city,
          topic: booking.topic,
          demoSlotLabel: booking.slotLabel,
          demoScheduledAt: booking.demo.scheduledAt.toISOString(),
          leadUrl,
        },
      });
    } catch (error) {
      // Saving a legitimate lead must not turn into a failed booking if a mail
      // provider or mail table is temporarily unavailable. Delivery records
      // retain configuration/provider failures when the email layer is reached.
      console.error("Demo email delivery setup failed", error instanceof Error ? error.message : error);
    }
    res.json({ ok: true, org: booking.org, demo: booking.demo });
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Could not save enquiry.");
  }
});

app.post("/api/saas/trial", async (req, res) => {
  try {
    const org = await createSaasTrial(req.body || {});
    if (!String(req.headers.accept || "").includes("application/json")) {
      return res.type("html").send(trialStartedHtml(org));
    }
    res.json({ ok: true, org });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not start trial.";
    if (!String(req.headers.accept || "").includes("application/json")) {
      return res.status(400).type("html").send(await marketingHtml(message));
    }
    sendError(res, 400, message);
  }
});

app.get("/anekio/renew", async (req, res) => {
  res.type("html").send(await saasRenewalHtml({ orgId: req.query.org, contact: req.query.contact }));
});

async function createSaasPaymentOrder(req: express.Request, res: express.Response) {
  try {
    const order = await createSaasRazorpayOrder(req.body || {});
    const wantsHtml = !String(req.headers.accept || "").includes("application/json");
    if (wantsHtml) {
      return res.type("html").send(saasCheckoutHtml(order));
    }
    res.json({ ok: true, order });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create payment order.";
    if (!String(req.headers.accept || "").includes("application/json")) {
      return res.status(400).type("html").send(await marketingHtml(message));
    }
    sendError(res, 400, message);
  }
}

app.post("/api/saas/payment/order", createSaasPaymentOrder);
app.post("/api/saas/razorpay/order", createSaasPaymentOrder);

async function verifySaasPaymentOrder(req: express.Request, res: express.Response) {
  try {
    res.json(await verifySaasRazorpayPayment(req.body || {}));
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Could not verify payment.");
  }
}

app.post("/api/saas/payment/verify", verifySaasPaymentOrder);
app.post("/api/saas/razorpay/verify", verifySaasPaymentOrder);

app.post("/api/pay/order", async (req, res) => {
  const pay = await getSchoolPaySecrets();
  if (!gatewayReady(pay)) return sendError(res, 503, "School has not connected a payment gateway yet");
  const { token, studentToken, invoiceIds } = req.body || {};
  if (!token && !studentToken) return sendError(res, 400, "Token required");
  try {
    const origin = `${req.protocol}://${req.get("host")}`;
    const order = await createSchoolFeeOrder(token || studentToken || "", origin, {
      studentToken,
      invoiceIds,
    });
    res.json(order);
  } catch (err) {
    sendError(res, 400, err instanceof Error ? err.message : "Could not create order");
  }
});

app.post("/api/pay/verify", async (req, res) => {
  const body = req.body || {};
  if (!body.token && !body.studentToken) return sendError(res, 400, "Incomplete payment");
  try {
    await verifySchoolPayment(body);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, 400, err instanceof Error ? err.message : "Could not record payment");
  }
});

app.post("/api/pay/webhook", async (req, res) => {
  const provider = String(req.query.provider || "razorpay");
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  try {
    if (provider === "cashfree") {
      const signature = String(req.headers["x-webhook-signature"] || "");
      const timestamp = String(req.headers["x-webhook-timestamp"] || "");
      if (!(await verifyCashfreeWebhook(raw, timestamp, signature))) return sendError(res, 400, "Bad signature");
      const event = JSON.parse(raw) as {
        type?: string;
        data?: { order?: { order_id?: string; order_tags?: { token?: string; invoiceId?: string } } };
      };
      if (event.type && !event.type.toLowerCase().includes("success") && event.type !== "PAYMENT_SUCCESS_WEBHOOK") {
        return res.json({ ok: true });
      }
      const orderId = event.data?.order?.order_id || "";
      const invoiceId =
        event.data?.order?.order_tags?.invoiceId ||
        (
          await prisma.feeInvoice.findUnique({
            where: { shareToken: event.data?.order?.order_tags?.token || "" },
            select: { id: true },
          })
        )?.id;
      if (orderId && invoiceId) await captureCashfreePayment({ invoiceId, orderId });
      return res.json({ ok: true });
    }
    const signature = String(req.headers["x-razorpay-signature"] || "");
    if (!(await verifyWebhookSignature(raw, signature))) return sendError(res, 400, "Bad signature");
    const event = JSON.parse(raw) as {
      event?: string;
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
            notes?: { token?: string; invoiceId?: string; studentToken?: string; periods?: string };
          };
        };
      };
    };
    if (event.event !== "payment.captured") return res.json({ ok: true });
    const entity = event.payload?.payment?.entity;
    const paymentId = entity?.id || "";
    if (entity?.notes?.studentToken && entity?.notes?.periods) {
      const months = await invoicesFromPeriods(entity.notes.studentToken, entity.notes.periods);
      if (paymentId && months.length) {
        await captureRazorpayMonths({
          invoiceIds: months.map((m) => m.id),
          paymentId,
          orderId: entity?.order_id,
        });
      }
      return res.json({ ok: true });
    }
    const invoiceId =
      entity?.notes?.invoiceId ||
      (
        await prisma.feeInvoice.findUnique({
          where: { shareToken: entity?.notes?.token || "" },
          select: { id: true },
        })
      )?.id;
    if (!paymentId || !invoiceId) return res.json({ ok: true });
    await captureRazorpayPayment({ invoiceId, paymentId, orderId: entity?.order_id });
    res.json({ ok: true });
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Webhook failed");
  }
});

app.post("/api/razorpay/order", (req, res, next) => {
  req.url = "/api/pay/order";
  app._router.handle(req, res, next);
});
app.post("/api/razorpay/verify", (req, res, next) => {
  req.url = "/api/pay/verify";
  app._router.handle(req, res, next);
});
app.post("/api/razorpay/webhook", (req, res, next) => {
  req.url = "/api/pay/webhook";
  app._router.handle(req, res, next);
});

app.all("/api/cron/fees", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).send("Unauthorized");
  }
  res.json(await issueDueFeesCore(new Date()));
});

app.post("/api/cron/exams", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).send("Unauthorized");
  }
  res.json(await runExamCronNotifications(new Date()));
});

app.get("/pay/s/:token", async (req, res) => {
  const html = await renderStudentPayPage(
    req.params.token,
    String(req.query.m || ""),
    req.query.embed === "1",
    req.query.paid === "1"
  );
  if (!html) return res.status(404).send("Not found");
  res.type("html").send(html);
});

app.get("/pay/:token/return", async (req, res) => {
  const orderId = String(req.query.order_id || req.query.orderid || "");
  const provider = String(req.query.provider || "").toUpperCase();
  if (orderId && (provider === "CASHFREE" || provider === "BILLDESK")) {
    try {
      await verifySchoolPayment({ token: req.params.token, provider, orderId });
    } catch {
      // show latest invoice either way
    }
  }
  res.redirect(`/pay/${req.params.token}`);
});

app.get("/pay/:token", async (req, res) => {
  const html = await renderPayPage(req.params.token, req.query.embed === "1", req.query.paid === "1");
  if (!html) return res.status(404).send("Not found");
  res.type("html").send(html);
});

app.get("/i/:token", async (req, res) => {
  const html = await renderInvoicePage(req.params.token);
  if (!html) return res.status(404).send("Not found");
  res.type("html").send(html);
});

app.get("/verify/:token", async (req, res) => {
  const row = await findIssuedDocument(req.params.token);
  if (!row) {
    return res.status(404).type("html").send(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Document not found</title></head><body style="font-family:Arial,sans-serif;background:#f4f7fb;color:#102a43"><main style="max-width:560px;margin:10vh auto;background:white;padding:28px;border:1px solid #d9e2ec;border-radius:14px"><h1>Document not found</h1><p>This verification code is invalid or unavailable. Check the printed code with the issuing school.</p></main></body></html>'
    );
  }
  res.type("html").send(verificationHtml(row));
});

app.get("/documents/:token", async (req, res) => {
  const row = await findIssuedDocument(req.params.token);
  if (!row || row.status === "REVOKED") return res.status(404).send("Document unavailable");
  res.type("html").send(row.renderedHtml);
});

app.get("/document-batches/:batchId", async (req, res) => {
  const rows = await findBatchDocuments(req.params.batchId);
  if (!rows.length) return res.status(404).send("Document batch unavailable");
  res.type("html").send(batchDocumentsHtml(rows));
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const demoDir = [argvRoot, path.resolve(serverDir, ".."), process.cwd()]
  .filter(Boolean)
  .map((root) => path.join(root, "public", "demo"))
  .find((dir) => existsSync(dir));
if (demoDir) {
  app.use("/demo", express.static(demoDir));
}

function resolveWebDir() {
  return [argvRoot, path.resolve(serverDir, ".."), process.cwd()]
    .filter(Boolean)
    .map((root) => path.join(root, "mobile", "dist"))
    .find((dir) => existsSync(path.join(dir, "index.html")));
}

let webDir = resolveWebDir();
function webRoot() {
  return webDir || (webDir = resolveWebDir()) || "";
}
function sendAppShell(_req: express.Request, res: express.Response, next: express.NextFunction) {
  const dir = webRoot();
  if (!dir) return next();
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(dir, "index.html"));
}
app.use((req, res, next) => {
  const dir = webRoot();
  if (!dir) return next();
  express.static(dir)(req, res, next);
});
app.get(["/", ...appShellRoutes], sendAppShell);
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (path.extname(req.path)) return next();
  if (
    req.path.startsWith("/api") ||
    req.path.startsWith("/pay") ||
    req.path.startsWith("/i") ||
    req.path.startsWith("/verify") ||
    req.path.startsWith("/documents") ||
    req.path.startsWith("/document-batches") ||
    req.path.startsWith("/demo") ||
    req.path === "/health"
  ) {
    return next();
  }
  sendAppShell(req, res, next);
});

export default app;

if (!process.env.VERCEL && (process.env.NODE_ENV !== "test" || process.env.TEST_SERVER_LISTEN === "1")) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Anekio API on http://localhost:${PORT}`);
  });
}
