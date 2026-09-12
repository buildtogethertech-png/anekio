import { prisma } from "./prisma";
import { gatewayReady, paySecretsFromRow } from "./pay-config";

type SchoolConfigRow = NonNullable<Awaited<ReturnType<typeof prisma.schoolConfig.findUnique>>>;

function configGatewayReady(row: SchoolConfigRow) {
  return gatewayReady(paySecretsFromRow({
    payGateway: row.payGateway,
    testMode: row.payTestMode,
    razorpayKeyId: row.razorpayKeyId,
    razorpayKeySecret: row.razorpayKeySecret,
    cashfreeAppId: row.cashfreeAppId,
    cashfreeSecretKey: row.cashfreeSecretKey,
    billdeskMerchantId: row.billdeskMerchantId,
    billdeskClientId: row.billdeskClientId,
    billdeskSecret: row.billdeskSecret,
  } as Parameters<typeof paySecretsFromRow>[0]));
}

async function singleReadySchoolConfig() {
  const rows = await prisma.schoolConfig.findMany({ where: { payGateway: { not: "NONE" } } });
  const ready = rows.filter(configGatewayReady);
  return ready.length === 1 ? ready[0] : null;
}

async function schoolConfigForOrg(orgId?: string | null) {
  if (orgId) {
    const scoped = await prisma.schoolConfig.findFirst({ where: { orgId } });
    if (scoped) return scoped;
  }
  const legacy = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  if (legacy && configGatewayReady(legacy)) return legacy;
  return await singleReadySchoolConfig() || legacy;
}

export async function getSharedInvoice(token: string) {
  const invoice = await prisma.feeInvoice.findUnique({
    where: { shareToken: token },
    include: {
      student: { include: { class: true, parent: { include: { user: true } } } },
      payments: true,
    },
  });
  if (!invoice) return null;
  const config = await schoolConfigForOrg(invoice.orgId || invoice.student.orgId);
  return { invoice, config };
}

export async function getStudentPay(token: string) {
  const student = await prisma.student.findUnique({
    where: { payToken: token },
    include: {
      class: true,
      parent: {
        include: {
          user: true,
          students: {
            include: {
              class: true,
              feeInvoices: {
                include: { payments: true },
                orderBy: { dueDate: "asc" },
              },
            },
          },
        },
      },
      feeInvoices: {
        include: { payments: true },
        orderBy: { dueDate: "asc" },
      },
    },
  });
  if (!student) return null;
  const config = await schoolConfigForOrg(student.orgId);
  return { student, config };
}
