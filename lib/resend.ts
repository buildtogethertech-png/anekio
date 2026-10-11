import { prisma } from "./prisma";
import { platformEmailConfigured, sendPlatformSystemEmail } from "./saas-email";

export async function getResendConfig() {
  const row = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const configured = await platformEmailConfigured();
  const fromName = row?.name?.trim() || "School";
  return { apiKey: "", fromEmail: "", fromName, configured };
}

export async function sendResendEmail(opts: {
  to?: string | null;
  studentName: string;
  title: string;
  amount: string;
  payUrl: string;
}) {
  const { fromName, configured } = await getResendConfig();
  if (!configured) throw new Error("Configure platform email delivery in Anekio Admin → Email delivery.");
  const to = (opts.to || "").trim().toLowerCase();
  if (!to || !to.includes("@")) throw new Error("Parent email is missing");

  const result = await sendPlatformSystemEmail({
    event: "FEE_REMINDER",
    to,
    variables: { schoolName: fromName, studentName: opts.studentName, title: opts.title, amount: opts.amount, payUrl: opts.payUrl },
  });
  return result.response;
}
