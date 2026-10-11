import { prisma } from "../lib/prisma";
import { feePeriod, feePeriodAfter } from "../lib/fees";

async function main() {
  const students = await prisma.student.findMany({
    where: { billingStartPeriod: "" },
    select: {
      id: true,
      feeInvoices: {
        select: { period: true, generatedThrough: true, templateId: true },
        orderBy: { period: "asc" },
      },
    },
  });
  const now = new Date();
  const currentPeriod = feePeriod(now.getFullYear(), now.getMonth());
  let updated = 0;
  for (const student of students) {
    const openingThrough = student.feeInvoices.find((invoice) => invoice.period === "OPENING")?.generatedThrough || "";
    const firstMonthly = student.feeInvoices.find((invoice) => invoice.templateId && /^\d{4}-(0[1-9]|1[0-2])$/.test(invoice.period))?.period || "";
    const start = /^\d{4}-(0[1-9]|1[0-2])$/.test(openingThrough)
      ? feePeriodAfter(openingThrough)
      : firstMonthly
        ? firstMonthly
        : currentPeriod;
    await prisma.student.update({ where: { id: student.id }, data: { billingStartPeriod: start } });
    updated += 1;
  }
  console.log(`Set billing start for ${updated} existing students.`);
}

main().finally(() => prisma.$disconnect());
