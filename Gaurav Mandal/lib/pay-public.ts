import { prisma } from "./prisma";

export async function getSharedInvoice(token: string) {
  const invoice = await prisma.feeInvoice.findUnique({
    where: { shareToken: token },
    include: {
      student: { include: { class: true, parent: { include: { user: true } } } },
      payments: true,
    },
  });
  if (!invoice) return null;
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  return { invoice, config };
}

export async function getStudentPay(token: string) {
  const student = await prisma.student.findUnique({
    where: { payToken: token },
    include: {
      class: true,
      parent: { include: { user: true } },
      feeInvoices: {
        include: { payments: true },
        orderBy: { dueDate: "asc" },
      },
    },
  });
  if (!student) return null;
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  return { student, config };
}
