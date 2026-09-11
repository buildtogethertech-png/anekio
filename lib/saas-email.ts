import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

/** The single platform-wide email configuration row. */
export const SAAS_EMAIL_CONFIG_ID = "anekio";

export const SAAS_EMAIL_EVENTS = ["DEMO_BOOKED"] as const;
export type SaasEmailEvent = (typeof SAAS_EMAIL_EVENTS)[number];

export const SAAS_EMAIL_AUDIENCES = ["INTERNAL", "CUSTOMER"] as const;
export type SaasEmailAudience = (typeof SAAS_EMAIL_AUDIENCES)[number];

export type SaasEmailEnvironment = "production" | "staging";

/** Values available to a platform email template. Keep this list in sync with the public booking flow. */
export const SAAS_EMAIL_TEMPLATE_VARIABLES = [
  "schoolName",
  "ownerName",
  "ownerEmail",
  "ownerPhone",
  "city",
  "topic",
  "demoSlotLabel",
  "demoScheduledAt",
  "leadUrl",
] as const;

export type SaasEmailTemplateVariables = Partial<Record<(typeof SAAS_EMAIL_TEMPLATE_VARIABLES)[number], unknown>> & Record<string, unknown>;

export type SaasEmailRuleSettings = {
  id: string;
  event: SaasEmailEvent;
  audience: SaasEmailAudience;
  enabled: boolean;
  sortOrder: number;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string[];
  subjectTemplate: string;
  textTemplate: string;
  htmlTemplate: string;
  createdAt: Date;
  updatedAt: Date;
};

/** This type intentionally has no API-key field. Platform keys are write-only in application code. */
export type SaasEmailSettings = {
  id: string;
  enabled: boolean;
  resendApiKeySet: boolean;
  productionFromName: string;
  productionFromEmail: string;
  stagingFromName: string;
  stagingFromEmail: string;
  stagingSafeRecipients: string[];
  createdAt: Date;
  updatedAt: Date;
  rules: SaasEmailRuleSettings[];
};

export type SaasEmailConfigInput = {
  enabled?: boolean | string | number;
  resendApiKey?: string;
  clearResendApiKey?: boolean | string | number;
  productionFromName?: string;
  productionFromEmail?: string;
  stagingFromName?: string;
  stagingFromEmail?: string;
  stagingSafeRecipients?: string[] | string;
};

export type SaasEmailRuleInput = {
  id?: string;
  event?: SaasEmailEvent | string;
  audience?: SaasEmailAudience | string;
  enabled?: boolean | string | number;
  sortOrder?: number | string;
  to?: string[] | string;
  cc?: string[] | string;
  bcc?: string[] | string;
  replyTo?: string[] | string;
  subjectTemplate?: string;
  textTemplate?: string;
  htmlTemplate?: string;
};

export type ResendEmailInput = {
  apiKey: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  subject: string;
  text?: string;
  html?: string;
};

export type ResendEmailResult = {
  messageId: string;
  response: unknown;
};

export type SaasEmailDeliveryResult = {
  audience: SaasEmailAudience;
  deliveryId: string;
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED" | "BLOCKED";
  resendMessageId: string;
  reason: string;
  duplicate: boolean;
};

export type SaasEmailDeliveryLogRow = {
  id: string;
  orgId: string;
  schoolName: string;
  ownerEmail: string;
  event: SaasEmailEvent;
  audience: SaasEmailAudience;
  environment: string;
  status: SaasEmailDeliveryResult["status"];
  fromEmail: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string[];
  subject: string;
  resendMessageId: string;
  errorMessage: string;
  attemptCount: number;
  createdAt: Date;
  attemptedAt: Date | null;
  sentAt: Date | null;
  updatedAt: Date;
};

export type SendSaasEmailEventInput = {
  event?: SaasEmailEvent;
  orgId: string;
  idempotencyKey: string;
  variables: SaasEmailTemplateVariables;
  /** Pass the incoming request hostname. Production is only anekio.com / www.anekio.com. */
  host?: string;
  /** Explicitly useful for jobs and tests; host takes precedence only when this is omitted. */
  environment?: SaasEmailEnvironment;
};

type StoredConfig = {
  id: string;
  enabled: boolean;
  resendApiKey: string;
  productionFromName: string;
  productionFromEmail: string;
  stagingFromName: string;
  stagingFromEmail: string;
  stagingSafeRecipients: string;
  createdAt: Date;
  updatedAt: Date;
};

type StoredRule = {
  id: string;
  configId: string;
  event: SaasEmailEvent;
  audience: SaasEmailAudience;
  enabled: boolean;
  sortOrder: number;
  toRecipients: string;
  ccRecipients: string;
  bccRecipients: string;
  replyTo: string;
  subjectTemplate: string;
  textTemplate: string;
  htmlTemplate: string;
  createdAt: Date;
  updatedAt: Date;
};

const DEFAULT_CONFIG = {
  id: SAAS_EMAIL_CONFIG_ID,
  enabled: false,
  resendApiKey: "",
  productionFromName: "Anekio Support",
  productionFromEmail: "support@anekio.com",
  stagingFromName: "Anekio Staging",
  // staging.anekio.com already belongs to the web deployment. Keep email on a separate mail subdomain.
  stagingFromEmail: "support@mail.staging.anekio.com",
  stagingSafeRecipients: JSON.stringify(["support@anekio.com"]),
} as const;

const DEFAULT_RULES: Array<Omit<StoredRule, "id" | "configId" | "createdAt" | "updatedAt">> = [
  {
    event: "DEMO_BOOKED",
    audience: "INTERNAL",
    enabled: true,
    sortOrder: 10,
    toRecipients: JSON.stringify(["support@anekio.com"]),
    ccRecipients: "[]",
    bccRecipients: "[]",
    replyTo: JSON.stringify(["support@anekio.com"]),
    subjectTemplate: "New Anekio demo booked · {{schoolName}}",
    textTemplate: `A new Anekio demo has been booked.

School: {{schoolName}}
Contact: {{ownerName}}
Email: {{ownerEmail}}
Phone: {{ownerPhone}}
City: {{city}}
Interested in: {{topic}}
Demo time: {{demoSlotLabel}}
CRM lead: {{leadUrl}}`,
    htmlTemplate: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55">
<h1 style="font-size:20px">New Anekio demo booked</h1>
<p><strong>School:</strong> {{schoolName}}</p>
<p><strong>Contact:</strong> {{ownerName}}<br><strong>Email:</strong> {{ownerEmail}}<br><strong>Phone:</strong> {{ownerPhone}}<br><strong>City:</strong> {{city}}</p>
<p><strong>Interested in:</strong> {{topic}}<br><strong>Demo time:</strong> {{demoSlotLabel}}</p>
<p><a href="{{leadUrl}}">Open CRM lead</a></p>
</div>`,
  },
  {
    event: "DEMO_BOOKED",
    audience: "CUSTOMER",
    enabled: true,
    sortOrder: 20,
    toRecipients: JSON.stringify(["{{ownerEmail}}"]),
    ccRecipients: "[]",
    bccRecipients: "[]",
    replyTo: JSON.stringify(["support@anekio.com"]),
    subjectTemplate: "Your Anekio demo is booked",
    textTemplate: `Hi {{ownerName}},

Thanks for booking an Anekio demo for {{schoolName}}.

Your selected time: {{demoSlotLabel}}

We will show you how Anekio can support your school. If you need to change the time, reply to this email.

Anekio Support`,
    htmlTemplate: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55;max-width:640px">
<p>Hi {{ownerName}},</p>
<p>Thanks for booking an Anekio demo for <strong>{{schoolName}}</strong>.</p>
<p><strong>Your selected time:</strong> {{demoSlotLabel}}</p>
<p>We will show you how Anekio can support your school. If you need to change the time, reply to this email.</p>
<p>Regards,<br>Anekio Support</p>
</div>`,
  },
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function has(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : value == null ? fallback : String(value).trim();
}

function boolean(value: unknown, fallback: boolean) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = text(value).toLowerCase();
  if (["true", "1", "on", "yes"].includes(normalized)) return true;
  if (["false", "0", "off", "no", ""].includes(normalized)) return false;
  return fallback;
}

function integer(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(parseList);
  if (typeof value !== "string") return value == null ? [] : [String(value).trim()].filter(Boolean);
  const source = value.trim();
  if (!source) return [];
  try {
    const decoded: unknown = JSON.parse(source);
    if (Array.isArray(decoded)) return decoded.flatMap(parseList);
  } catch {
    // Settings forms may submit a comma- or line-separated list rather than JSON.
  }
  return source.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function uniqueList(value: unknown) {
  const seen = new Set<string>();
  return parseList(value).filter((item) => {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function encodedList(value: unknown) {
  return JSON.stringify(uniqueList(value));
}

function email(value: string) {
  const candidate = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : "";
}

function maskEmail(value: string) {
  const normalized = email(value);
  if (!normalized) return value ? "invalid-recipient" : "";
  const [local, domain] = normalized.split("@");
  const safeLocal = local.length <= 3 ? `${local[0] || ""}...` : `${local.slice(0, 3)}...`;
  return `${safeLocal}@${domain}`;
}

function maskList(values: string[]) {
  return values.map(maskEmail).filter(Boolean);
}

function duplicateRouteRecipients(input: { to: string[]; cc: string[]; bcc: string[] }) {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  const fields: Array<[string, string[]]> = [["To", input.to], ["CC", input.cc], ["BCC", input.bcc]];
  for (const [label, values] of fields) {
    for (const value of values) {
      const normalized = email(value);
      if (!normalized) continue;
      const firstSeen = seen.get(normalized);
      if (firstSeen) {
        duplicates.push(`${maskEmail(normalized)} is in ${firstSeen} and ${label}`);
      } else {
        seen.set(normalized, label);
      }
    }
  }
  return duplicates;
}

function logSaasEmail(message: string, details: Record<string, unknown>) {
  try {
    console.info(`[saas-email] ${message}`, JSON.stringify(details));
  } catch {
    console.info(`[saas-email] ${message}`);
  }
}

function logDeliveryResult(message: string, input: {
  event: SaasEmailEvent;
  audience: SaasEmailAudience;
  orgId: string;
  idempotencyKey: string;
  environment: SaasEmailEnvironment;
  mail: RenderedMail;
  result: SaasEmailDeliveryResult;
}) {
  logSaasEmail(message, {
    event: input.event,
    audience: input.audience,
    orgId: input.orgId,
    idempotencyKey: input.idempotencyKey,
    deliveryId: input.result.deliveryId,
    environment: input.environment,
    status: input.result.status,
    reason: input.result.reason || undefined,
    duplicate: input.result.duplicate,
    resendMessageId: input.result.resendMessageId ? "present" : "",
    from: maskEmail(input.mail.fromEmail),
    to: maskList(input.mail.to),
    cc: maskList(input.mail.cc),
    bcc: maskList(input.mail.bcc),
    replyTo: maskList(input.mail.replyTo),
    subjectSet: Boolean(input.mail.subject.trim()),
  });
}

function status(value: string): SaasEmailDeliveryResult["status"] {
  if (["PENDING", "SENT", "FAILED", "SKIPPED", "BLOCKED"].includes(value)) return value as SaasEmailDeliveryResult["status"];
  return "FAILED";
}

function limited(value: unknown, length = 2000) {
  return String(value ?? "").slice(0, length);
}

function publicSettings(config: StoredConfig, rules: StoredRule[]): SaasEmailSettings {
  return {
    id: config.id,
    enabled: config.enabled,
    resendApiKeySet: Boolean(config.resendApiKey.trim()),
    productionFromName: config.productionFromName,
    productionFromEmail: config.productionFromEmail,
    stagingFromName: config.stagingFromName,
    stagingFromEmail: config.stagingFromEmail,
    stagingSafeRecipients: uniqueList(config.stagingSafeRecipients),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    rules: rules.map(ruleSettings),
  };
}

function ruleSettings(rule: StoredRule): SaasEmailRuleSettings {
  return {
    id: rule.id,
    event: rule.event,
    audience: rule.audience,
    enabled: rule.enabled,
    sortOrder: rule.sortOrder,
    to: uniqueList(rule.toRecipients),
    cc: uniqueList(rule.ccRecipients),
    bcc: uniqueList(rule.bccRecipients),
    replyTo: uniqueList(rule.replyTo),
    subjectTemplate: rule.subjectTemplate,
    textTemplate: rule.textTemplate,
    htmlTemplate: rule.htmlTemplate,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

/** Creates the singleton configuration and default rules without overwriting a configured installation. */
async function ensureSaasEmailDefaultsRaw(client: PrismaClient = prisma) {
  const config = await client.saasEmailConfig.upsert({
    where: { id: SAAS_EMAIL_CONFIG_ID },
    create: DEFAULT_CONFIG,
    update: {},
  });
  await Promise.all(
    DEFAULT_RULES.map((rule) =>
      client.saasEmailRule.upsert({
        where: { configId_event_audience: { configId: config.id, event: rule.event, audience: rule.audience } },
        create: { ...rule, configId: config.id },
        update: {},
      })
    )
  );
  return config;
}

/** Ensures defaults without exposing the stored API key to a caller. */
export async function ensureSaasEmailDefaults(client: PrismaClient = prisma) {
  await ensureSaasEmailDefaultsRaw(client);
}

/** Alias used by the seed without ever exposing the API key. */
export async function seedSaasEmailDefaults(client: PrismaClient = prisma) {
  await ensureSaasEmailDefaultsRaw(client);
}

export async function getSaasEmailSettings(): Promise<SaasEmailSettings> {
  const config = (await ensureSaasEmailDefaultsRaw()) as StoredConfig;
  const rules = (await prisma.saasEmailRule.findMany({
    where: { configId: config.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  })) as StoredRule[];
  return publicSettings(config, rules);
}

/** Compatibility name for callers that only need the redacted platform config. */
export const getSaasEmailConfig = getSaasEmailSettings;

export async function listSaasEmailRules(): Promise<SaasEmailRuleSettings[]> {
  return (await getSaasEmailSettings()).rules;
}

export async function listSaasEmailDeliveryLogs(limit = 25): Promise<SaasEmailDeliveryLogRow[]> {
  const take = Math.max(1, Math.min(100, Math.round(Number(limit) || 25)));
  const rows = await prisma.saasEmailDelivery.findMany({
    orderBy: [{ createdAt: "desc" }],
    take,
    include: { org: { select: { schoolName: true, ownerEmail: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    orgId: row.orgId,
    schoolName: row.org.schoolName,
    ownerEmail: row.org.ownerEmail,
    event: row.event as SaasEmailEvent,
    audience: row.audience as SaasEmailAudience,
    environment: row.environment,
    status: status(String(row.status)),
    fromEmail: row.fromEmail,
    to: uniqueList(row.toRecipients),
    cc: uniqueList(row.ccRecipients),
    bcc: uniqueList(row.bccRecipients),
    replyTo: uniqueList(row.replyTo),
    subject: row.subject,
    resendMessageId: row.resendMessageId,
    errorMessage: row.errorMessage,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
    attemptedAt: row.attemptedAt,
    sentAt: row.sentAt,
    updatedAt: row.updatedAt,
  }));
}

/**
 * Saves platform configuration without reading the stored Resend key back to a caller.
 * An empty `resendApiKey` means "keep the current key"; `clearResendApiKey` is explicit.
 */
export async function saveSaasEmailConfig(input: SaasEmailConfigInput | Record<string, unknown>, actorEmail: string) {
  const current = (await ensureSaasEmailDefaultsRaw()) as StoredConfig;
  const source = record(input);
  const nextKey = boolean(source.clearResendApiKey, false)
    ? ""
    : has(source, "resendApiKey") && text(source.resendApiKey)
      ? text(source.resendApiKey)
      : current.resendApiKey;
  const next = await prisma.saasEmailConfig.update({
    where: { id: current.id },
    data: {
      enabled: boolean(source.enabled, current.enabled),
      resendApiKey: nextKey,
      productionFromName: has(source, "productionFromName") ? text(source.productionFromName) : current.productionFromName,
      productionFromEmail: has(source, "productionFromEmail") ? text(source.productionFromEmail).toLowerCase() : current.productionFromEmail,
      stagingFromName: has(source, "stagingFromName") ? text(source.stagingFromName) : current.stagingFromName,
      stagingFromEmail: has(source, "stagingFromEmail") ? text(source.stagingFromEmail).toLowerCase() : current.stagingFromEmail,
      stagingSafeRecipients: has(source, "stagingSafeRecipients") ? encodedList(source.stagingSafeRecipients) : current.stagingSafeRecipients,
    },
  });
  await prisma.saasAuditEvent.create({
    data: {
      actorEmail: text(actorEmail, "system"),
      action: "SAAS_EMAIL_CONFIG_UPDATED",
      entityType: "EMAIL_CONFIG",
      entityId: next.id,
      detail: `Email ${next.enabled ? "enabled" : "disabled"} · production sender ${next.productionFromEmail} · staging sender ${next.stagingFromEmail}`,
    },
  });
  return getSaasEmailSettings();
}

/** Compatibility name for callers that use update terminology. */
export const updateSaasEmailConfig = saveSaasEmailConfig;

function event(value: unknown, fallback?: SaasEmailEvent): SaasEmailEvent {
  const candidate = text(value).toUpperCase();
  if ((SAAS_EMAIL_EVENTS as readonly string[]).includes(candidate)) return candidate as SaasEmailEvent;
  if (fallback) return fallback;
  throw new Error("Choose a supported email event.");
}

function audience(value: unknown, fallback?: SaasEmailAudience): SaasEmailAudience {
  const candidate = text(value).toUpperCase();
  if ((SAAS_EMAIL_AUDIENCES as readonly string[]).includes(candidate)) return candidate as SaasEmailAudience;
  if (fallback) return fallback;
  throw new Error("Choose INTERNAL or CUSTOMER email routing.");
}

function ruleListField(source: Record<string, unknown>, current: StoredRule | null, inputName: "to" | "cc" | "bcc" | "replyTo", column: "toRecipients" | "ccRecipients" | "bccRecipients" | "replyTo") {
  if (has(source, inputName)) return encodedList(source[inputName]);
  if (has(source, column)) return encodedList(source[column]);
  return current ? current[column] : "[]";
}

/**
 * Creates or updates one route. A route is unique per event/audience, while each route can
 * contain any number of To, CC, BCC, and Reply-To recipients.
 */
export async function saveSaasEmailRule(input: SaasEmailRuleInput | Record<string, unknown>, actorEmail: string): Promise<SaasEmailRuleSettings> {
  const config = await ensureSaasEmailDefaultsRaw();
  const source = record(input);
  const id = text(source.id);
  const byId = id ? ((await prisma.saasEmailRule.findUnique({ where: { id } })) as StoredRule | null) : null;
  if (id && !byId) throw new Error("Email rule not found.");
  if (byId && byId.configId !== config.id) throw new Error("Email rule belongs to a different configuration.");

  const ruleEvent = event(source.event, byId?.event);
  const ruleAudience = audience(source.audience, byId?.audience);
  const existing =
    byId ||
    ((await prisma.saasEmailRule.findFirst({ where: { configId: config.id, event: ruleEvent, audience: ruleAudience } })) as StoredRule | null);
  const data = {
    enabled: boolean(source.enabled, existing?.enabled ?? true),
    sortOrder: integer(source.sortOrder, existing?.sortOrder ?? (ruleAudience === "INTERNAL" ? 10 : 20)),
    toRecipients: ruleListField(source, existing, "to", "toRecipients"),
    ccRecipients: ruleListField(source, existing, "cc", "ccRecipients"),
    bccRecipients: ruleListField(source, existing, "bcc", "bccRecipients"),
    replyTo: ruleListField(source, existing, "replyTo", "replyTo"),
    subjectTemplate: has(source, "subjectTemplate") ? String(source.subjectTemplate ?? "") : existing?.subjectTemplate ?? "",
    textTemplate: has(source, "textTemplate") ? String(source.textTemplate ?? "") : existing?.textTemplate ?? "",
    htmlTemplate: has(source, "htmlTemplate") ? String(source.htmlTemplate ?? "") : existing?.htmlTemplate ?? "",
  };
  const saved = existing
    ? await prisma.saasEmailRule.update({ where: { id: existing.id }, data })
    : await prisma.saasEmailRule.create({ data: { ...data, configId: config.id, event: ruleEvent, audience: ruleAudience } });
  await prisma.saasAuditEvent.create({
    data: {
      actorEmail: text(actorEmail, "system"),
      action: "SAAS_EMAIL_RULE_UPDATED",
      entityType: "EMAIL_RULE",
      entityId: saved.id,
      detail: `${saved.event} · ${saved.audience} · ${saved.enabled ? "enabled" : "disabled"}`,
    },
  });
  return ruleSettings(saved as StoredRule);
}

/** Compatibility name for form handlers. */
export const updateSaasEmailRule = saveSaasEmailRule;

export function escapeSaasEmailHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function templateValue(value: unknown, format: "html" | "text" | "subject" | "recipient") {
  const raw = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (format === "html") return escapeSaasEmailHtml(raw);
  if (format === "subject" || format === "recipient") return raw.replace(/[\r\n]+/g, " ").trim();
  return raw;
}

/** Replaces {{variable}} values. HTML renderings always escape variable values, never the configured template itself. */
export function renderSaasEmailTemplate(
  template: string,
  variables: SaasEmailTemplateVariables,
  format: "html" | "text" | "subject" | "recipient" = "text"
) {
  return String(template ?? "").replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g, (_whole, key: string) => templateValue(variables[key], format));
}

/**
 * Production is deliberately restricted to the two public Anekio hosts. Vercel uses
 * `--prod` for staging too, so NODE_ENV and VERCEL_ENV are unsafe for this decision.
 */
export function resolveSaasEmailEnvironment(input: Pick<SendSaasEmailEventInput, "host" | "environment"> = {}): SaasEmailEnvironment {
  if (input.environment === "production" || input.environment === "staging") return input.environment;
  const host = text(input.host).toLowerCase().replace(/\.$/, "").split(":")[0];
  return host === "anekio.com" || host === "www.anekio.com" ? "production" : "staging";
}

/** Generic low-level Resend sender. It supports every recipient field as an array. */
export async function sendResendPlatformEmail(input: ResendEmailInput): Promise<ResendEmailResult> {
  if (!input.apiKey.trim()) throw new Error("Resend API key has not been configured.");
  if (!input.to.length) throw new Error("At least one recipient is required.");
  if (!input.subject.trim()) throw new Error("Email subject is required.");
  if (!text(input.text) && !text(input.html)) throw new Error("An email needs a plain-text or HTML body.");

  const payload: Record<string, unknown> = {
    from: input.from,
    to: input.to,
    subject: input.subject,
  };
  if (input.cc?.length) payload.cc = input.cc;
  if (input.bcc?.length) payload.bcc = input.bcc;
  if (input.replyTo?.length) payload.reply_to = input.replyTo;
  if (text(input.text)) payload.text = input.text;
  if (text(input.html)) payload.html = input.html;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const result = record(body);
    const nested = record(result.error);
    throw new Error(text(result.message) || text(nested.message) || `Resend could not send email (${response.status}).`);
  }
  return { messageId: text(record(body).id), response: body };
}

type RenderedMail = {
  from: string;
  fromEmail: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string[];
  subject: string;
  text: string;
  html: string;
  issue: string;
};

function validRecipients(values: string[]) {
  const invalid = values.filter((value) => !email(value));
  return { valid: values.map(email).filter(Boolean), invalid };
}

function sender(name: string, address: string) {
  const fromEmail = email(address);
  const safeName = String(name || "").replace(/[\r\n<>]+/g, " ").trim();
  return { fromEmail, from: safeName ? `${safeName} <${fromEmail}>` : fromEmail };
}

function renderedList(templateList: string, variables: SaasEmailTemplateVariables) {
  return uniqueList(templateList).map((item) => renderSaasEmailTemplate(item, variables, "recipient"));
}

function renderMail(input: {
  config: StoredConfig;
  rule: StoredRule | null;
  variables: SaasEmailTemplateVariables;
  environment: SaasEmailEnvironment;
}): RenderedMail {
  const { config, rule, variables, environment } = input;
  const selectedSender =
    environment === "production"
      ? sender(config.productionFromName, config.productionFromEmail)
      : sender(config.stagingFromName, config.stagingFromEmail);
  const blank: RenderedMail = {
    from: selectedSender.from,
    fromEmail: selectedSender.fromEmail,
    to: [],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: "",
    text: "",
    html: "",
    issue: "",
  };
  if (!rule) return { ...blank, issue: "No configured email rule exists for this audience." };
  if (!rule.enabled) return { ...blank, issue: "Email rule is disabled." };
  if (!config.enabled) return { ...blank, issue: "Platform email delivery is disabled." };
  if (!config.resendApiKey.trim()) return { ...blank, issue: "Resend API key has not been configured." };
  if (!selectedSender.fromEmail) return { ...blank, issue: `The ${environment} sender address is invalid.` };

  const replyTo = validRecipients(renderedList(rule.replyTo, variables));
  if (replyTo.invalid.length) return { ...blank, issue: "Reply-To contains an invalid email address." };

  const subject = renderSaasEmailTemplate(rule.subjectTemplate, variables, "subject").trim();
  const plainText = renderSaasEmailTemplate(rule.textTemplate, variables, "text");
  const html = renderSaasEmailTemplate(rule.htmlTemplate, variables, "html");
  if (!subject) return { ...blank, issue: "Email subject is empty." };
  if (!plainText.trim() && !html.trim()) return { ...blank, issue: "Email body is empty." };

  if (environment === "staging") {
    const safe = validRecipients(uniqueList(config.stagingSafeRecipients));
    if (!safe.valid.length || safe.invalid.length) {
      return { ...blank, subject, text: plainText, html, issue: "Staging safe recipients must contain valid email addresses before mail can be sent." };
    }
    return {
      ...blank,
      to: safe.valid,
      replyTo: replyTo.valid,
      subject,
      text: plainText,
      html,
    };
  }

  const to = validRecipients(renderedList(rule.toRecipients, variables));
  const cc = validRecipients(renderedList(rule.ccRecipients, variables));
  const bcc = validRecipients(renderedList(rule.bccRecipients, variables));
  if (!to.valid.length) return { ...blank, subject, text: plainText, html, issue: "Email route has no valid To recipient." };
  if (to.invalid.length || cc.invalid.length || bcc.invalid.length) {
    return { ...blank, subject, text: plainText, html, issue: "Email route contains an invalid recipient." };
  }
  const duplicates = duplicateRouteRecipients({ to: to.valid, cc: cc.valid, bcc: bcc.valid });
  if (duplicates.length) {
    return { ...blank, subject, text: plainText, html, issue: `Email route has duplicate recipients across To/CC/BCC: ${duplicates.join("; ")}.` };
  }
  return {
    ...blank,
    to: to.valid,
    cc: cc.valid,
    bcc: bcc.valid,
    replyTo: replyTo.valid,
    subject,
    text: plainText,
    html,
  };
}

type DeliveryClaimInput = {
  orgId: string;
  rule: StoredRule | null;
  event: SaasEmailEvent;
  audience: SaasEmailAudience;
  environment: SaasEmailEnvironment;
  idempotencyKey: string;
  mail: RenderedMail;
};

type StoredDelivery = {
  id: string;
  audience: SaasEmailAudience;
  status: string;
  resendMessageId: string;
  errorMessage: string;
};

async function claimExistingDelivery(input: DeliveryClaimInput, delivery: StoredDelivery) {
  // A completed or in-flight delivery is idempotent. A skipped, blocked, or
  // provider-failed delivery remains explicitly retryable when the event is
  // triggered again after its configuration/problem has been corrected.
  if (["SENT", "PENDING"].includes(delivery.status)) return { delivery, duplicate: true };
  const retry = await prisma.saasEmailDelivery.update({
    where: { id: delivery.id },
    data: {
      ruleId: input.rule?.id || null,
      environment: input.environment,
      status: "PENDING",
      fromEmail: input.mail.fromEmail,
      toRecipients: encodedList(input.mail.to),
      ccRecipients: encodedList(input.mail.cc),
      bccRecipients: encodedList(input.mail.bcc),
      replyTo: encodedList(input.mail.replyTo),
      subject: limited(input.mail.subject, 500),
      resendMessageId: "",
      errorMessage: "",
      attemptedAt: null,
      sentAt: null,
    },
  });
  return { delivery: retry, duplicate: false };
}

async function claimDelivery(input: DeliveryClaimInput) {
  const existing = await prisma.saasEmailDelivery.findFirst({
    where: { event: input.event, idempotencyKey: input.idempotencyKey, audience: input.audience },
  });
  if (existing) return claimExistingDelivery(input, existing);
  try {
    const delivery = await prisma.saasEmailDelivery.create({
      data: {
        orgId: input.orgId,
        ruleId: input.rule?.id || null,
        event: input.event,
        audience: input.audience,
        environment: input.environment,
        idempotencyKey: input.idempotencyKey,
        fromEmail: input.mail.fromEmail,
        toRecipients: encodedList(input.mail.to),
        ccRecipients: encodedList(input.mail.cc),
        bccRecipients: encodedList(input.mail.bcc),
        replyTo: encodedList(input.mail.replyTo),
        subject: limited(input.mail.subject, 500),
      },
    });
    return { delivery, duplicate: false };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const delivery = await prisma.saasEmailDelivery.findFirst({
      where: { event: input.event, idempotencyKey: input.idempotencyKey, audience: input.audience },
    });
    if (!delivery) throw error;
    return claimExistingDelivery(input, delivery);
  }
}

function deliveryResult(delivery: {
  id: string;
  audience: SaasEmailAudience;
  status: string;
  resendMessageId: string;
  errorMessage: string;
}, duplicate: boolean): SaasEmailDeliveryResult {
  return {
    audience: delivery.audience,
    deliveryId: delivery.id,
    status: status(delivery.status),
    resendMessageId: delivery.resendMessageId,
    reason: delivery.errorMessage,
    duplicate,
  };
}

async function finishDelivery(id: string, statusValue: SaasEmailDeliveryResult["status"], input: { messageId?: string; reason?: string }) {
  const now = new Date();
  return prisma.saasEmailDelivery.update({
    where: { id },
    data: {
      status: statusValue,
      resendMessageId: limited(input.messageId, 500),
      errorMessage: limited(input.reason, 2000),
      attemptedAt: now,
      sentAt: statusValue === "SENT" ? now : null,
      attemptCount: { increment: statusValue === "SENT" || statusValue === "FAILED" ? 1 : 0 },
    },
  });
}

async function deliverRule(input: {
  config: StoredConfig;
  rule: StoredRule | null;
  event: SaasEmailEvent;
  audience: SaasEmailAudience;
  orgId: string;
  idempotencyKey: string;
  variables: SaasEmailTemplateVariables;
  environment: SaasEmailEnvironment;
  blockedReason?: string;
}): Promise<SaasEmailDeliveryResult> {
  const mail = renderMail({ config: input.config, rule: input.rule, variables: input.variables, environment: input.environment });
  const claim = await claimDelivery({ ...input, mail });
  if (claim.duplicate) {
    const result = deliveryResult(claim.delivery, true);
    logDeliveryResult("delivery duplicate", { ...input, mail, result });
    return result;
  }

  if (input.blockedReason) {
    const delivery = await finishDelivery(claim.delivery.id, "BLOCKED", { reason: input.blockedReason });
    const result = deliveryResult(delivery, false);
    logDeliveryResult("delivery blocked", { ...input, mail, result });
    return result;
  }
  if (mail.issue) {
    const delivery = await finishDelivery(claim.delivery.id, "SKIPPED", { reason: mail.issue });
    const result = deliveryResult(delivery, false);
    logDeliveryResult("delivery skipped", { ...input, mail, result });
    return result;
  }
  try {
    const sent = await sendResendPlatformEmail({
      apiKey: input.config.resendApiKey,
      from: mail.from,
      to: mail.to,
      cc: mail.cc,
      bcc: mail.bcc,
      replyTo: mail.replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    const delivery = await finishDelivery(claim.delivery.id, "SENT", { messageId: sent.messageId });
    const result = deliveryResult(delivery, false);
    logDeliveryResult("delivery sent", { ...input, mail, result });
    return result;
  } catch (error) {
    const delivery = await finishDelivery(claim.delivery.id, "FAILED", { reason: error instanceof Error ? error.message : "Resend could not send email." });
    const result = deliveryResult(delivery, false);
    logDeliveryResult("delivery failed", { ...input, mail, result });
    return result;
  }
}

/**
 * Sends configured routes in a deliberate order. Internal mail must be accepted by Resend
 * before a customer message is attempted; otherwise later routes are recorded as BLOCKED.
 * This function returns delivery results instead of turning a saved website lead into a 500.
 */
export async function sendSaasEmailEvent(input: SendSaasEmailEventInput): Promise<SaasEmailDeliveryResult[]> {
  const eventName = event(input.event, "DEMO_BOOKED");
  const orgId = text(input.orgId);
  const idempotencyKey = text(input.idempotencyKey);
  if (!orgId) throw new Error("Organisation is required for an email delivery.");
  if (!idempotencyKey) throw new Error("An email idempotency key is required.");

  const config = (await ensureSaasEmailDefaultsRaw()) as StoredConfig;
  const rules = (await prisma.saasEmailRule.findMany({ where: { configId: config.id, event: eventName } })) as StoredRule[];
  const environment = resolveSaasEmailEnvironment(input);
  const ordered: Array<{ audience: SaasEmailAudience; rule: StoredRule | null }> = SAAS_EMAIL_AUDIENCES.map((audienceName) => ({
    audience: audienceName,
    rule: rules.find((rule) => rule.audience === audienceName) || null,
  }));
  logSaasEmail("event start", {
    event: eventName,
    orgId,
    idempotencyKey,
    host: text(input.host),
    environment,
    deliveryEnabled: config.enabled,
    resendApiKeySet: Boolean(config.resendApiKey.trim()),
    productionFrom: maskEmail(config.productionFromEmail),
    stagingFrom: maskEmail(config.stagingFromEmail),
    ruleCount: rules.length,
  });

  const deliveries: SaasEmailDeliveryResult[] = [];
  let internalFailure = "";
  for (const route of ordered) {
    const result = await deliverRule({
      config,
      rule: route.rule,
      event: eventName,
      audience: route.audience,
      orgId,
      idempotencyKey,
      variables: input.variables || {},
      environment,
      blockedReason: route.audience === "CUSTOMER" && internalFailure ? `Customer email blocked: ${internalFailure}` : undefined,
    });
    deliveries.push(result);
    if (route.audience === "INTERNAL" && result.status !== "SENT") {
      internalFailure = result.reason || `Internal email delivery status: ${result.status}.`;
    }
  }
  return deliveries;
}
