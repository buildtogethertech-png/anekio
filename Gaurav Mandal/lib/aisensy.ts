import { prisma } from "./prisma";

export function indiaWhatsAppNumber(raw?: string | null) {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return "";
}

export async function getAisensyConfig() {
  const row = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const apiKey = row?.aisensyApiKey?.trim() || "";
  const campaign = row?.aisensyCampaign?.trim() || "fee_reminder";
  return { apiKey, campaign, configured: Boolean(apiKey && campaign) };
}

export async function sendAisensyWhatsApp(opts: {
  phone?: string | null;
  userName: string;
  params: string[];
}) {
  const { apiKey, campaign, configured } = await getAisensyConfig();
  if (!configured) throw new Error("Connect the school's AiSensy key in Admin → School → Communication");
  const destination = indiaWhatsAppNumber(opts.phone);
  if (!destination) throw new Error("Parent phone is missing or not a valid Indian number");

  const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey,
      campaignName: campaign,
      destination: `+${destination}`,
      userName: opts.userName,
      source: "Anekio",
      templateParams: opts.params,
    }),
  });
  const raw = await res.text();
  const body = parseJson(raw);
  if (!res.ok || isAisensyFailure(body)) {
    throw new Error(aisensyError(res.status, body, raw));
  }
  return body;
}

function parseJson(raw: string) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function isAisensyFailure(body: unknown) {
  if (!body || typeof body !== "object") return false;
  const row = body as { success?: boolean; errorCode?: number; errorMessage?: string };
  return row.success === false || Boolean(row.errorCode) || Boolean(row.errorMessage);
}

function aisensyError(status: number, body: unknown, raw: string) {
  if (body && typeof body === "object") {
    const row = body as Record<string, unknown>;
    const nested = row.error && typeof row.error === "object" ? (row.error as Record<string, unknown>) : null;
    const text = [row.errorMessage, row.message, typeof row.error === "string" ? row.error : null, nested?.errorMessage, nested?.message].find(
      (v) => typeof v === "string" && v.trim()
    );
    if (typeof text === "string") return text.trim();
  }
  if (raw.trim() && raw.length < 280) return raw.trim();
  return `AiSensy could not send WhatsApp (${status})`;
}
