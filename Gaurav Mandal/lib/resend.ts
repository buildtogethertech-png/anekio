import { prisma } from "./prisma";

export async function getResendConfig() {
  const row = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const apiKey = row?.resendApiKey?.trim() || "";
  const fromEmail = row?.resendFromEmail?.trim() || "";
  const fromName = row?.name?.trim() || "School";
  return { apiKey, fromEmail, fromName, configured: Boolean(apiKey && fromEmail) };
}

export function feeReminderEmail(opts: {
  schoolName: string;
  studentName: string;
  title: string;
  amount: string;
  payUrl: string;
}) {
  const subject = `Fee reminder · ${opts.studentName} · ${opts.title}`;
  const text = `Dear Parent,

This is a reminder that the school fee for ${opts.studentName} (${opts.title}) is pending.

Amount due: ₹${opts.amount}

Please complete the payment using this secure link:
${opts.payUrl}

If you have already paid, please ignore this message.

Thank you.
${opts.schoolName}`;
  const html = `<div style="font-family:Georgia,serif;color:#1c1917;line-height:1.55;max-width:32rem">
<p>Dear Parent,</p>
<p>This is a reminder that the school fee for <strong>${escapeHtml(opts.studentName)}</strong> (${escapeHtml(opts.title)}) is pending.</p>
<p>Amount due: <strong>₹${escapeHtml(opts.amount)}</strong></p>
<p><a href="${escapeAttr(opts.payUrl)}" style="display:inline-block;background:#c45c26;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px">Pay now</a></p>
<p style="font-size:13px;color:#57534e">Or open ${escapeHtml(opts.payUrl)}</p>
<p>If you have already paid, please ignore this message.</p>
<p>Thank you.<br/>${escapeHtml(opts.schoolName)}</p>
</div>`;
  return { subject, text, html };
}

export async function sendResendEmail(opts: {
  to?: string | null;
  studentName: string;
  title: string;
  amount: string;
  payUrl: string;
}) {
  const { apiKey, fromEmail, fromName, configured } = await getResendConfig();
  if (!configured) throw new Error("Connect the school's Resend key in Admin → School → Communication");
  const to = (opts.to || "").trim().toLowerCase();
  if (!to || !to.includes("@")) throw new Error("Parent email is missing");

  const mail = feeReminderEmail({
    schoolName: fromName,
    studentName: opts.studentName,
    title: opts.title,
    amount: opts.amount,
    payUrl: opts.payUrl,
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (body as { message?: string }).message ||
      (body as { error?: { message?: string } }).error?.message ||
      "Resend could not send email";
    throw new Error(message);
  }
  return body;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
