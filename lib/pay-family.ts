import { invoiceBalance, expandOldestUnpaidInvoiceIds } from "./fees";
import { prisma } from "./prisma";

export async function invoicesForStudentMonths(studentToken: string, invoiceIds: string[]) {
  const student = await prisma.student.findUnique({
    where: { payToken: studentToken },
    select: { id: true, parentId: true },
  });
  if (!student) throw new Error("Pay link is not valid");
  const familyInvoices = await prisma.feeInvoice.findMany({
    // Siblings pay together; a student with no parent yet pays alone (never match every parentless student).
    where: student.parentId ? { student: { parentId: student.parentId } } : { studentId: student.id },
    include: { student: true, payments: true },
  });
  const expanded = expandOldestUnpaidInvoiceIds(
    familyInvoices.map((inv) => ({
      id: inv.id,
      studentId: inv.studentId,
      dueDate: inv.dueDate,
      title: inv.title,
      dueNow: invoiceBalance(inv).dueNow,
    })),
    invoiceIds
  );
  const wanted = new Set(expanded);
  const open = familyInvoices
    .filter((inv) => wanted.has(inv.id))
    .filter((inv) => invoiceBalance(inv).dueNow > 0)
    .sort((a, b) => +a.dueDate - +b.dueDate || a.title.localeCompare(b.title));
  if (!open.length) throw new Error("Those months are already paid");
  return open;
}
