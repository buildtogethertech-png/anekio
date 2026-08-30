import "dotenv/config";
import cors from "cors";
import express from "express";
import { existsSync } from "fs";
import path from "path";
import multer from "multer";
import bcrypt from "bcryptjs";
import { signAppToken } from "../lib/app-jwt";
import { hasAny, userFromAuthHeader } from "../lib/http-user";
import { userForLogin } from "../lib/login";
import { serializeUser } from "../lib/http-user";
import { publicNav, navForPortal } from "../lib/nav";
import { recordPayload } from "../lib/api-v1-record";
import { homePayload, serializeNotice } from "../lib/api-v1-home";
import { noticesForUser } from "../lib/data";
import { runAct } from "../lib/run-act";
import { handleFileUpload } from "../lib/handle-upload";
import { readUpload, resolveUploadPath } from "../lib/uploads";
import { gatewayReady, getSchoolPaySecrets } from "../lib/pay-config";
import { createSchoolFeeOrder, verifySchoolPayment, invoicesFromPeriods } from "../lib/pay";
import { batchDocumentsHtml, findBatchDocuments, findIssuedDocument, verificationHtml } from "../lib/document-studio";
import { prisma } from "../lib/prisma";
import { verifyCashfreeWebhook, captureCashfreePayment } from "../lib/cashfree";
import { captureRazorpayPayment, captureRazorpayMonths, verifyWebhookSignature } from "../lib/razorpay";
import { issueDueFeesCore } from "../lib/fee-run";
import { runExamPaperDeadlineNotifications } from "../lib/exam-notification-run";
import { ensureAccessRoles } from "../lib/roles";
import { scopePolicyFor } from "../lib/permissions";
import { renderInvoicePage, renderPayPage, renderStudentPayPage } from "./pay-html";
import { createAdmissionLeadFromWebsite, schoolWebsiteHtml } from "../lib/school-website";
import {
  adminHtml,
  createSaasEnquiry,
  createSaasRazorpayOrder,
  marketingHtml,
  robotsTxt,
  sitemapXml,
  updateSaasOrg,
} from "../lib/cultivate-site";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const PORT = Number(process.env.PORT || 4000);

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

function sendError(res: express.Response, status: number, error: string) {
  res.status(status).json({ error });
}

async function requireUser(req: express.Request, res: express.Response) {
  const user = await userFromAuthHeader(req.headers.authorization);
  if (!user) {
    sendError(res, 401, "Sign in again.");
    return null;
  }
  return user;
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
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role.slug,
    roleName: row.role.name,
    roleId: row.roleId,
    portal: row.role.portal,
    permissions: row.role.grants.map((g) => g.permission),
    scopes: Object.fromEntries(
      row.role.grants.map((g) => [g.permission, g.scope ?? scopePolicyFor(g.permission, row.role.portal).defaultScope])
    ),
    isSystemRole: row.role.isSystem,
  };
  const token = signAppToken(row.id);
  const nav = navForPortal(user.portal, user.permissions).map(publicNav);
  res.json({ token, user: serializeUser(user), nav });
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

app.get("/api/v1/record", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const allowed = hasAny(user, [
    "children.view",
    "self.view",
    "attendance.mark",
    "desk.view",
    "people.view",
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

app.get("/api/v1/home", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json(await homePayload(user, typeof req.query.childId === "string" ? req.query.childId : null));
});

app.get("/api/v1/notices", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
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
  try {
    res.json(await runAct(user, (req.body || {}) as Record<string, unknown>));
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Could not save.");
  }
});

app.post("/api/files", upload.single("file"), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
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

app.get("/api/files/*rel", async (req, res) => {
  const param = req.params.rel;
  const rel = decodeURIComponent(Array.isArray(param) ? param.join("/") : String(param || ""));
  try {
    const { publicSchool } = resolveUploadPath(rel);
    if (!publicSchool) {
      const user = await userFromAuthHeader(req.headers.authorization);
      if (!user) return sendError(res, 401, "Unauthorized");
    }
    const { buf, type } = await readUpload(rel);
    res.setHeader("Content-Type", type);
    res.send(buf);
  } catch {
    sendError(res, 404, "Not found");
  }
});

app.get("/school/:slug", async (req, res) => {
  const html = await schoolWebsiteHtml(String(req.params.slug || ""));
  if (!html) return sendError(res, 404, "School website not found");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.post("/school/:slug/lead", async (req, res) => {
  try {
    await createAdmissionLeadFromWebsite(String(req.params.slug || ""), req.body || {});
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enquiry sent</title><style>body{margin:0;background:#f5f8fc;font-family:Arial,sans-serif;color:#102a43}.card{max-width:520px;margin:12vh auto;background:white;border:1px solid #d9e2ec;border-radius:20px;padding:28px;text-align:center}a{display:inline-block;margin-top:16px;color:#1d4ed8;font-weight:700}</style></head><body><main class="card"><h1>Enquiry sent</h1><p>Thank you. The school office will contact you soon.</p><a href="/school/${encodeURIComponent(String(req.params.slug || ""))}">Back to school website</a></main></body></html>`);
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Could not send enquiry.");
  }
});

app.get(["/", "/features", "/pricing"], (_req, res) => {
  res.type("html").send(marketingHtml());
});

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send(robotsTxt());
});

app.get("/sitemap.xml", (_req, res) => {
  res.type("application/xml").send(sitemapXml());
});

app.get("/cultivate/enquiry", (_req, res) => {
  res.type("html").send(marketingHtml());
});

app.post("/cultivate/enquiry", async (req, res) => {
  try {
    await createSaasEnquiry(req.body || {});
    res.type("html").send(marketingHtml("Thanks — enquiry saved. We will follow up with the school owner."));
  } catch (e) {
    res.status(400).type("html").send(marketingHtml(e instanceof Error ? e.message : "Could not save enquiry."));
  }
});

app.get("/cultivate-admin", async (_req, res) => {
  res.type("html").send(await adminHtml());
});

app.post("/cultivate-admin/orgs", async (req, res) => {
  try {
    await createSaasEnquiry(req.body || {});
    res.type("html").send(await adminHtml("Organisation saved."));
  } catch (e) {
    res.status(400).type("html").send(await adminHtml(e instanceof Error ? e.message : "Could not save organisation."));
  }
});

app.post("/cultivate-admin/orgs/:id", async (req, res) => {
  try {
    await updateSaasOrg(String(req.params.id || ""), req.body || {});
    res.type("html").send(await adminHtml("Organisation updated."));
  } catch (e) {
    res.status(400).type("html").send(await adminHtml(e instanceof Error ? e.message : "Could not update organisation."));
  }
});

app.post("/api/saas/enquiry", async (req, res) => {
  try {
    res.json({ ok: true, org: await createSaasEnquiry(req.body || {}) });
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : "Could not save enquiry.");
  }
});

app.post("/api/saas/razorpay/order", async (req, res) => {
  try {
    const order = await createSaasRazorpayOrder(req.body || {});
    const wantsHtml = !String(req.headers.accept || "").includes("application/json");
    if (wantsHtml) {
      return res.type("html").send(
        marketingHtml(`Razorpay order created for ${order.org.schoolName}. Order ID: ${order.orderId}. Checkout UI can be connected when keys are live.`)
      );
    }
    res.json({ ok: true, order });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create Razorpay order.";
    if (!String(req.headers.accept || "").includes("application/json")) {
      return res.status(400).type("html").send(marketingHtml(message));
    }
    sendError(res, 400, message);
  }
});

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
  res.json(await runExamPaperDeadlineNotifications(new Date()));
});

app.get("/pay/s/:token", async (req, res) => {
  const html = await renderStudentPayPage(req.params.token, String(req.query.m || ""), req.query.embed === "1");
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

const webDir = path.join(process.cwd(), "mobile", "dist");
if (existsSync(webDir)) {
  app.use(express.static(webDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (
      req.path.startsWith("/api") ||
      req.path.startsWith("/pay") ||
      req.path.startsWith("/i") ||
      req.path.startsWith("/verify") ||
      req.path.startsWith("/documents") ||
      req.path.startsWith("/document-batches") ||
      req.path === "/health"
    ) {
      return next();
    }
    res.sendFile(path.join(webDir, "index.html"));
  });
}

export default app;

if (!process.env.VERCEL && (process.env.NODE_ENV !== "test" || process.env.TEST_SERVER_LISTEN === "1")) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Cultivate API on http://localhost:${PORT}`);
  });
}
