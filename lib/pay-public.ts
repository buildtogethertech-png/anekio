import { prisma } from "./prisma";

async function schoolConfigForOrg(orgId?: string | null) {
  if (orgId) {
    const scoped = await prisma.schoolConfig.findFirst({ where: { orgId } });
    if (scoped) return scoped;
  }
  return prisma.schoolConfig.findUnique({ where: { id: "school" } });
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
