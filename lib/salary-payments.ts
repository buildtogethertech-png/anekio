import { PayrollStatus } from "@prisma/client";
import { can, type AccessUser } from "./permissions";
import { prisma } from "./prisma";
import { personKey, salaryPayState, SALARY_PAY_MODES, type SalaryPayMode } from "./payroll";

function need(user: AccessUser, ...keys: string[]) {
  if (!keys.some((k) => can(user, k))) throw new Error("No access.");
}

function cleanMonth(value: unknown) {
  const month = String(value || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Pick a month.");
  return month;
}

function cleanDate(value: unknown) {
  const raw = String(value || "").slice(0, 10);
  if (!raw) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("Paid on must be a date.");
  return raw;
}

function cleanMode(value: unknown): SalaryPayMode {
  const mode = String(value || "BANK").toUpperCase();
  return (SALARY_PAY_MODES as readonly string[]).includes(mode) ? (mode as SalaryPayMode) : "BANK";
}

/** Only accept proofs uploaded through the "salaryProof" upload kind. */
function cleanProof(value: unknown) {
  const path = String(value || "").replace(/^\/+/, "").trim();
  if (!path) return "";
  if (!path.startsWith("private/") || !path.includes("/payroll/proofs/")) throw new Error("Upload the proof again.");
  return path.slice(0, 300);
}

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

async function stateFor(key: string, month: string) {
  const [run, payments] = await Promise.all([
    prisma.staffPayrollRun.findUnique({ where: { personKey_month: { personKey: key, month } } }),
    prisma.staffSalaryPayment.findMany({ where: { personKey: key, month } }),
  ]);
  return { run, ...salaryPayState(run, payments.map((p) => ({ amount: p.amount, voided: Boolean(p.voidedAt) }))) };
}

/** Live (not voided) payments for a person-month; used to block unlocking a paid month. */
export async function hasLiveSalaryPayments(key: string, month: string) {
  const n = await prisma.staffSalaryPayment.count({ where: { personKey: key, month, voidedAt: null } });
  return n > 0;
}

/** Keep the run's status in step with its payments: fully paid → PAID, otherwise back to APPROVED. */
async function syncRunStatus(key: string, month: string) {
  const s = await stateFor(key, month);
  if (!s.run || s.run.status === "PENDING") return s;
  const next = s.state === "PAID" ? PayrollStatus.PAID : PayrollStatus.APPROVED;
  if (s.run.status !== next) {
    await prisma.staffPayrollRun.update({ where: { id: s.run.id }, data: { status: next } });
  }
  return stateFor(key, month);
}

export async function recordStaffSalaryPaymentCore(
  user: AccessUser,
  input: {
    kind: "teacher" | "staff";
    id: string;
    month: string;
    amount: number;
    paidOn?: string;
    mode?: string;
    reference?: string;
    note?: string;
    proofPath?: string;
  }
) {
  need(user, "salary.pay");
  const month = cleanMonth(input.month);
  const key = personKey(input.kind === "teacher" ? "teacher" : "staff", String(input.id || ""));
  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount more than ₹0.");
  const s = await stateFor(key, month);
  if (!s.run || s.run.status === "PENDING") throw new Error("Approve this month's salary before recording a payment.");
  if (s.balance <= 0) throw new Error("This month is already fully paid.");
  if (amount > s.balance) throw new Error(`That's more than the ${inr(s.balance)} still owed.`);
  await prisma.staffSalaryPayment.create({
    data: {
      personKey: key,
      month,
      amount,
      paidOn: cleanDate(input.paidOn),
      mode: cleanMode(input.mode),
      reference: String(input.reference || "").trim().slice(0, 80),
      note: String(input.note || "").trim().slice(0, 200),
      proofPath: cleanProof(input.proofPath),
      createdById: user.id,
    },
  });
  const next = await syncRunStatus(key, month);
  return { due: next.due, paid: next.paid, balance: next.balance, state: next.state };
}

/** Pay the full remaining balance for many people in one go (same date and method). */
export async function recordStaffSalaryPaymentsBulkCore(
  user: AccessUser,
  input: {
    month: string;
    people: { kind: "teacher" | "staff"; id: string }[];
    paidOn?: string;
    mode?: string;
    reference?: string;
    proofPath?: string;
  }
) {
  need(user, "salary.pay");
  const month = cleanMonth(input.month);
  const paidOn = cleanDate(input.paidOn);
  const proofPath = cleanProof(input.proofPath);
  const mode = cleanMode(input.mode);
  const reference = String(input.reference || "").trim().slice(0, 80);
  const people = Array.isArray(input.people) ? input.people.slice(0, 500) : [];
  let paidCount = 0;
  let total = 0;
  let skipped = 0;
  for (const person of people) {
    const key = personKey(person.kind === "teacher" ? "teacher" : "staff", String(person.id || ""));
    const s = await stateFor(key, month);
    if (!s.run || s.run.status === "PENDING" || s.balance <= 0) {
      skipped += 1;
      continue;
    }
    await prisma.staffSalaryPayment.create({
      data: { personKey: key, month, amount: s.balance, paidOn, mode, reference, proofPath, note: "Bulk payment", createdById: user.id },
    });
    await syncRunStatus(key, month);
    paidCount += 1;
    total += s.balance;
  }
  return { paidCount, total, skipped };
}

export async function voidStaffSalaryPaymentCore(user: AccessUser, input: { paymentId: string; reason?: string }) {
  need(user, "salary.pay");
  const reason = String(input.reason || "").trim();
  if (!reason) throw new Error("Add a reason for cancelling this payment.");
  const row = await prisma.staffSalaryPayment.findUnique({ where: { id: String(input.paymentId || "") } });
  if (!row) throw new Error("Payment not found.");
  if (row.voidedAt) throw new Error("This payment is already cancelled.");
  await prisma.staffSalaryPayment.update({
    where: { id: row.id },
    data: { voidedAt: new Date(), voidedById: user.id, voidReason: reason.slice(0, 200) },
  });
  const next = await syncRunStatus(row.personKey, row.month);
  return { due: next.due, paid: next.paid, balance: next.balance, state: next.state };
}
