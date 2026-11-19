/**
 * School expenses. Two kinds of entry, one table:
 *  - Miscellaneous: someone spent money, they record it (no approval, the money is already gone).
 *  - Recurring: rent, internet … set up once; each period shows as due until it is paid.
 * Every expense has two dates: paidOn (the day money went out, for the daily report) and
 * forMonth (the month it belongs to, for profit and loss). Salary is read from StaffSalaryPayment.
 */
import { can, type AccessUser } from "./permissions";
import { prisma } from "./prisma";

export const EXPENSE_MODES = ["CASH", "UPI", "BANK", "CHEQUE"] as const;
export const RECURRING_EVERY = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 } as const;
type Every = keyof typeof RECURRING_EVERY;

const DEFAULT_CATEGORIES = [
  "Rent",
  "Electricity",
  "Internet & phone",
  "Transport & fuel",
  "Stationery & printing",
  "Repairs & maintenance",
  "Cleaning & housekeeping",
  "Events & functions",
  "Miscellaneous",
];
const SALARY = "Salary";

function need(user: AccessUser, ...keys: string[]) {
  if (!keys.some((k) => can(user, k))) throw new Error("No access.");
}

/** Today in India as YYYY-MM-DD. */
export function todayIst(now = new Date()) {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function cleanDate(value: unknown, label = "Date") {
  const raw = String(value || "").slice(0, 10);
  if (!raw) return todayIst();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) throw new Error(`${label} must be a date.`);
  return raw;
}

function cleanMonth(value: unknown, fallback?: string) {
  const month = String(value || fallback || "").slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Pick a month.");
  return month;
}

function cleanMode(value: unknown) {
  const mode = String(value || "CASH").toUpperCase();
  return (EXPENSE_MODES as readonly string[]).includes(mode) ? mode : "CASH";
}

function cleanAmount(value: unknown) {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount more than ₹0.");
  if (amount > 1_00_00_00_000) throw new Error("That amount is too large.");
  return amount;
}

function text(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

/** Only accept bills uploaded through the "expenseBill" upload kind. */
function cleanProof(value: unknown) {
  const path = String(value || "").replace(/^\/+/, "").trim();
  if (!path) return "";
  if (!path.startsWith("private/") || !path.includes("/expenses/bills/")) throw new Error("Upload the bill again.");
  return path.slice(0, 300);
}

function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthDiff(from: string, to: string) {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function lastDay(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function dueOn(month: string, day: number) {
  return `${month}-${String(Math.min(Math.max(1, day), lastDay(month))).padStart(2, "0")}`;
}

/** April–March session that holds this month, e.g. 2026-11 → 2026-04 … 2027-03. */
function sessionMonths(month: string) {
  const [y, m] = month.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return Array.from({ length: 12 }, (_, i) => addMonths(`${startYear}-04`, i));
}

function isEvery(value: string): value is Every {
  return value in RECURRING_EVERY;
}

/** Does this recurring cost fall due in the given month? */
function fallsIn(r: { startMonth: string; every: string }, month: string) {
  const step = isEvery(r.every) ? RECURRING_EVERY[r.every] : 1;
  const diff = monthDiff(r.startMonth, month);
  return diff >= 0 && diff % step === 0;
}

async function ensureCategories() {
  const count = await prisma.expenseCategory.count();
  if (count) return;
  await prisma.expenseCategory.createMany({
    data: DEFAULT_CATEGORIES.map((name, sort) => ({ name, sort })),
  });
}

async function categoryOrNull(id: unknown) {
  const categoryId = String(id || "");
  if (!categoryId) return null;
  const row = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
  if (!row) throw new Error("Pick a category.");
  return row.id;
}

// ─── Heads ─────────────────────────────────────────────────────────────────────

export async function saveExpenseCategoryCore(user: AccessUser, input: { id?: string; name?: string; archived?: boolean }) {
  need(user, "expenses.manage");
  const name = text(input.name, 60);
  if (input.id) {
    const row = await prisma.expenseCategory.findUnique({ where: { id: String(input.id) } });
    if (!row) throw new Error("Category not found.");
    if (typeof input.archived === "boolean" && !input.name) {
      await prisma.expenseCategory.update({
        where: { id: row.id },
        data: { archivedAt: input.archived ? new Date() : null, updatedById: user.id },
      });
      return { id: row.id };
    }
    if (!name) throw new Error("Give the category a name.");
    if (name.toLowerCase() === SALARY.toLowerCase()) throw new Error("Salary comes from the Salary tab on its own.");
    const clash = await prisma.expenseCategory.findFirst({ where: { name, id: { not: row.id } } });
    if (clash) throw new Error(`"${name}" already exists.`);
    await prisma.expenseCategory.update({ where: { id: row.id }, data: { name, updatedById: user.id } });
    return { id: row.id };
  }
  if (!name) throw new Error("Give the category a name.");
  if (name.toLowerCase() === SALARY.toLowerCase()) throw new Error("Salary comes from the Salary tab on its own.");
  const existing = await prisma.expenseCategory.findFirst({ where: { name } });
  if (existing) {
    if (!existing.archivedAt) throw new Error(`"${name}" already exists.`);
    await prisma.expenseCategory.update({ where: { id: existing.id }, data: { archivedAt: null, updatedById: user.id } });
    return { id: existing.id };
  }
  const max = await prisma.expenseCategory.aggregate({ _max: { sort: true } });
  const row = await prisma.expenseCategory.create({
    data: { name, sort: (max._max.sort ?? 0) + 1, createdById: user.id, updatedById: user.id },
  });
  return { id: row.id };
}

// ─── Recurring ─────────────────────────────────────────────────────────────────

export async function saveRecurringExpenseCore(
  user: AccessUser,
  input: {
    id?: string;
    name?: string;
    categoryId?: string;
    amount?: number;
    every?: string;
    dueDay?: number;
    startMonth?: string;
    payee?: string;
    note?: string;
    archived?: boolean;
  }
) {
  need(user, "expenses.manage");
  if (input.id && typeof input.archived === "boolean" && input.name === undefined) {
    const row = await prisma.recurringExpense.findUnique({ where: { id: String(input.id) } });
    if (!row) throw new Error("Recurring expense not found.");
    await prisma.recurringExpense.update({
      where: { id: row.id },
      data: { archivedAt: input.archived ? new Date() : null, updatedById: user.id },
    });
    return { id: row.id };
  }
  const name = text(input.name, 80);
  if (!name) throw new Error("Name it, e.g. School building rent.");
  const every = String(input.every || "MONTHLY").toUpperCase();
  if (!isEvery(every)) throw new Error("Pick how often it is paid.");
  const dueDay = Math.round(Number(input.dueDay || 1));
  if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) throw new Error("Due day must be between 1 and 31.");
  const data = {
    name,
    categoryId: await categoryOrNull(input.categoryId),
    amount: cleanAmount(input.amount),
    every,
    dueDay,
    startMonth: cleanMonth(input.startMonth, todayIst().slice(0, 7)),
    payee: text(input.payee, 80),
    note: text(input.note, 200),
    updatedById: user.id,
  };
  if (input.id) {
    const row = await prisma.recurringExpense.findUnique({ where: { id: String(input.id) } });
    if (!row) throw new Error("Recurring expense not found.");
    await prisma.recurringExpense.update({ where: { id: row.id }, data });
    return { id: row.id };
  }
  const row = await prisma.recurringExpense.create({ data: { ...data, createdById: user.id } });
  return { id: row.id };
}

// ─── Expenses ──────────────────────────────────────────────────────────────────

type ExpenseInput = {
  id?: string;
  paidOn?: string;
  forMonth?: string;
  amount?: number;
  categoryId?: string;
  recurringId?: string;
  mode?: string;
  payee?: string;
  reference?: string;
  note?: string;
  proofPath?: string;
};

/** The person who entered it may fix it the same day; after that only "Set up expenses" can. */
function canChange(user: AccessUser, row: { createdById: string | null; createdAt: Date }) {
  if (can(user, "expenses.manage")) return true;
  return row.createdById === user.id && todayIst(row.createdAt) === todayIst();
}

export async function saveExpenseCore(user: AccessUser, input: ExpenseInput) {
  need(user, "expenses.add", "expenses.manage");
  const paidOn = cleanDate(input.paidOn, "Paid on");
  if (paidOn > todayIst()) throw new Error("Paid on can't be in the future.");
  let recurringId: string | null = null;
  let categoryId = await categoryOrNull(input.categoryId);
  let forMonth = paidOn.slice(0, 7);
  if (input.recurringId) {
    const r = await prisma.recurringExpense.findUnique({ where: { id: String(input.recurringId) } });
    if (!r) throw new Error("Recurring expense not found.");
    recurringId = r.id;
    categoryId = categoryId ?? r.categoryId;
    forMonth = cleanMonth(input.forMonth, paidOn.slice(0, 7));
  } else if (input.forMonth) {
    forMonth = cleanMonth(input.forMonth);
  }
  if (!categoryId && !recurringId) throw new Error("Pick a category.");
  const data = {
    paidOn,
    forMonth,
    amount: cleanAmount(input.amount),
    categoryId,
    recurringId,
    mode: cleanMode(input.mode),
    payee: text(input.payee, 80),
    reference: text(input.reference, 80),
    note: text(input.note, 300),
    proofPath: cleanProof(input.proofPath),
    updatedById: user.id,
  };
  if (input.id) {
    const row = await prisma.expense.findUnique({ where: { id: String(input.id) } });
    if (!row) throw new Error("Expense not found.");
    if (row.voidedAt) throw new Error("This expense is cancelled.");
    if (!canChange(user, row)) throw new Error("Only the same day, by the person who entered it. Ask the admin to fix it.");
    await prisma.expense.update({ where: { id: row.id }, data });
    return { id: row.id };
  }
  const row = await prisma.expense.create({ data: { ...data, createdById: user.id } });
  return { id: row.id };
}

export async function voidExpenseCore(user: AccessUser, input: { id?: string; reason?: string }) {
  need(user, "expenses.add", "expenses.manage");
  const reason = text(input.reason, 200);
  if (!reason) throw new Error("Add a reason for cancelling.");
  const row = await prisma.expense.findUnique({ where: { id: String(input.id || "") } });
  if (!row) throw new Error("Expense not found.");
  if (row.voidedAt) throw new Error("Already cancelled.");
  if (!canChange(user, row)) throw new Error("Only the same day, by the person who entered it. Ask the admin to cancel it.");
  await prisma.expense.update({
    where: { id: row.id },
    data: { voidedAt: new Date(), voidedById: user.id, voidReason: reason, updatedById: user.id },
  });
  return { id: row.id };
}

// ─── Read ──────────────────────────────────────────────────────────────────────

export type ExpenseRow = {
  id: string;
  source: "EXPENSE" | "SALARY";
  paidOn: string;
  forMonth: string;
  amount: number;
  categoryId: string | null;
  category: string;
  recurringId: string | null;
  recurringName: string;
  mode: string;
  payee: string;
  reference: string;
  note: string;
  proofPath: string;
  createdBy: string;
  createdAt: string;
  voided: boolean;
  voidReason: string;
  canEdit: boolean;
};

async function salaryNames(keys: string[]) {
  const teacherIds = keys.filter((k) => k.startsWith("teacher:")).map((k) => k.slice(8));
  const staffIds = keys.filter((k) => k.startsWith("staff:")).map((k) => k.slice(6));
  const [teachers, staff] = await Promise.all([
    teacherIds.length ? prisma.teacher.findMany({ where: { id: { in: teacherIds } }, select: { id: true, user: { select: { name: true } } } }) : [],
    staffIds.length ? prisma.staffMember.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }) : [],
  ]);
  const names = new Map<string, string>();
  for (const t of teachers) names.set(`teacher:${t.id}`, t.user.name);
  for (const s of staff) names.set(`staff:${s.id}`, s.name);
  return names;
}

async function userNames(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  if (!unique.length) return new Map<string, string>();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** Expected salary for a month: approved pay where it exists, otherwise each person's monthly salary. */
async function expectedSalary(month: string) {
  const [runs, teachers, staff] = await Promise.all([
    prisma.staffPayrollRun.findMany({ where: { month }, select: { personKey: true, finalAmount: true, status: true } }),
    prisma.teacher.findMany({ where: { teachingOnly: false }, select: { id: true, monthlySalary: true } }),
    prisma.staffMember.findMany({ where: { archivedAt: null }, select: { id: true, monthlySalary: true } }),
  ]);
  const approved = new Map(runs.filter((r) => r.status !== "PENDING").map((r) => [r.personKey, r.finalAmount]));
  let total = 0;
  for (const t of teachers) total += approved.get(`teacher:${t.id}`) ?? t.monthlySalary;
  for (const s of staff) total += approved.get(`staff:${s.id}`) ?? s.monthlySalary;
  return total;
}

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  // IST midnight boundaries.
  const start = new Date(Date.UTC(y, m - 1, 1) - 330 * 60_000);
  const end = new Date(Date.UTC(y, m, 1) - 330 * 60_000);
  return { start, end };
}

export async function loadExpensesCore(user: AccessUser, input: { from?: string; to?: string; month?: string }) {
  need(user, "expenses.add", "expenses.view", "expenses.manage");
  await ensureCategories();
  const seeAll = can(user, "expenses.view") || can(user, "expenses.manage");
  const today = todayIst();
  const to = cleanDate(input.to || today, "To");
  const from = cleanDate(input.from || `${today.slice(0, 7)}-01`, "From");
  if (from > to) throw new Error("From must be before To.");
  const month = cleanMonth(input.month, today.slice(0, 7));

  const [categories, recurringRows, expenses, salary] = await Promise.all([
    prisma.expenseCategory.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }] }),
    prisma.recurringExpense.findMany({ orderBy: [{ archivedAt: "asc" }, { name: "asc" }] }),
    prisma.expense.findMany({
      where: { paidOn: { gte: from, lte: to }, ...(seeAll ? {} : { createdById: user.id }) },
      orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
      take: 2000,
    }),
    seeAll
      ? prisma.staffSalaryPayment.findMany({
          where: { paidOn: { gte: from, lte: to } },
          orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
          take: 2000,
        })
      : Promise.resolve([]),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const recName = new Map(recurringRows.map((r) => [r.id, r.name]));
  const [people, users] = await Promise.all([
    salaryNames(salary.map((s) => s.personKey)),
    userNames([...expenses.map((e) => e.createdById), ...salary.map((s) => s.createdById)]),
  ]);

  const rows: ExpenseRow[] = [
    ...expenses.map((e) => ({
      id: e.id,
      source: "EXPENSE" as const,
      paidOn: e.paidOn,
      forMonth: e.forMonth,
      amount: e.amount,
      categoryId: e.categoryId,
      category: (e.categoryId && catName.get(e.categoryId)) || "Other",
      recurringId: e.recurringId,
      recurringName: (e.recurringId && recName.get(e.recurringId)) || "",
      mode: e.mode,
      payee: e.payee,
      reference: e.reference,
      note: e.note,
      proofPath: e.proofPath,
      createdBy: (e.createdById && users.get(e.createdById)) || "",
      createdAt: e.createdAt.toISOString(),
      voided: Boolean(e.voidedAt),
      voidReason: e.voidReason,
      canEdit: !e.voidedAt && canChange(user, e),
    })),
    ...salary.map((s) => ({
      id: s.id,
      source: "SALARY" as const,
      paidOn: s.paidOn,
      forMonth: s.month,
      amount: s.amount,
      categoryId: null,
      category: SALARY,
      recurringId: null,
      recurringName: "",
      mode: s.mode,
      payee: people.get(s.personKey) || "Employee",
      reference: s.reference,
      note: s.note,
      proofPath: s.proofPath,
      createdBy: (s.createdById && users.get(s.createdById)) || "",
      createdAt: s.createdAt.toISOString(),
      voided: Boolean(s.voidedAt),
      voidReason: s.voidReason,
      canEdit: false,
    })),
  ].sort((a, b) => (a.paidOn === b.paidOn ? b.createdAt.localeCompare(a.createdAt) : b.paidOn.localeCompare(a.paidOn)));

  // Daily and per-head totals for the picked range (cash basis: the day money went out).
  const live = rows.filter((r) => !r.voided);
  const byDay = new Map<string, number>();
  const byHead = new Map<string, number>();
  for (const r of live) {
    byDay.set(r.paidOn, (byDay.get(r.paidOn) ?? 0) + r.amount);
    byHead.set(r.category, (byHead.get(r.category) ?? 0) + r.amount);
  }
  const range = {
    from,
    to,
    total: live.reduce((s, r) => s + r.amount, 0),
    count: live.length,
    today: byDay.get(today) ?? 0,
    byDay: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, amount]) => ({ date, amount })),
    byHead: [...byHead.entries()].sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({ name, amount })),
  };

  // Recurring: what fell due in the last 12 months and the next period, and what was paid against it.
  const activeRecurring = recurringRows.filter((r) => !r.archivedAt);
  const recurringPaid = activeRecurring.length
    ? await prisma.expense.findMany({
        where: { recurringId: { in: activeRecurring.map((r) => r.id) }, voidedAt: null, forMonth: { gte: addMonths(today.slice(0, 7), -12) } },
        select: { recurringId: true, forMonth: true, amount: true },
      })
    : [];
  const paidFor = new Map<string, number>();
  for (const p of recurringPaid) paidFor.set(`${p.recurringId}|${p.forMonth}`, (paidFor.get(`${p.recurringId}|${p.forMonth}`) ?? 0) + p.amount);
  const thisMonth = today.slice(0, 7);
  const recurring = recurringRows.map((r) => {
    const periods: { forMonth: string; dueOn: string; amount: number; paid: number; status: "PAID" | "PARTIAL" | "OVERDUE" | "DUE" | "UPCOMING" }[] = [];
    if (!r.archivedAt) {
      for (let i = -12; i <= 1; i += 1) {
        const m = addMonths(thisMonth, i);
        if (!fallsIn(r, m)) continue;
        const due = dueOn(m, r.dueDay);
        const paid = paidFor.get(`${r.id}|${m}`) ?? 0;
        const status = paid >= r.amount ? "PAID" : paid > 0 ? "PARTIAL" : due < today ? "OVERDUE" : m <= thisMonth ? "DUE" : "UPCOMING";
        if (i > 0 && status === "UPCOMING" && monthDiff(thisMonth, m) > 0 && due > addDays(today, 10)) continue;
        periods.push({ forMonth: m, dueOn: due, amount: r.amount, paid, status });
      }
    }
    return {
      id: r.id,
      name: r.name,
      categoryId: r.categoryId,
      category: (r.categoryId && catName.get(r.categoryId)) || "",
      amount: r.amount,
      every: r.every,
      dueDay: r.dueDay,
      startMonth: r.startMonth,
      payee: r.payee,
      note: r.note,
      archived: Boolean(r.archivedAt),
      periods,
    };
  });
  const pending = recurring
    .flatMap((r) => r.periods.filter((p) => p.status !== "PAID" && p.status !== "UPCOMING").map((p) => ({ ...p, recurringId: r.id, name: r.name })))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  return {
    today,
    canAdd: can(user, "expenses.add") || can(user, "expenses.manage"),
    canSeeAll: seeAll,
    canManage: can(user, "expenses.manage"),
    categories: categories.map((c) => ({ id: c.id, name: c.name, archived: Boolean(c.archivedAt) })),
    rows,
    range,
    recurring,
    pending,
    profitLoss: seeAll ? await profitLoss(month, recurringRows) : null,
  };
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Month profit and loss (accrual: forMonth), plus the April–March session month by month. */
async function profitLoss(month: string, recurringRows: { id: string; name: string; amount: number; every: string; startMonth: string; archivedAt: Date | null; categoryId: string | null }[]) {
  const session = sessionMonths(month);
  const first = session[0];
  const last = session[11];
  const [expenses, salary, receipts, invoices, categories] = await Promise.all([
    prisma.expense.findMany({ where: { voidedAt: null, forMonth: { gte: first, lte: last } }, select: { forMonth: true, amount: true, categoryId: true, recurringId: true } }),
    prisma.staffSalaryPayment.findMany({ where: { voidedAt: null, month: { gte: first, lte: last } }, select: { month: true, amount: true } }),
    prisma.feeReceipt.findMany({
      where: { status: "ACTIVE", paidAt: { gte: monthRange(first).start, lt: monthRange(last).end } },
      select: { paidAt: true, amount: true },
    }),
    prisma.feeInvoice.findMany({ where: { dueDate: { gte: monthRange(month).start, lt: monthRange(month).end } }, select: { amount: true } }),
    prisma.expenseCategory.findMany({ select: { id: true, name: true } }),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  const trend = session.map((m) => {
    const income = receipts.filter((r) => todayIst(r.paidAt).slice(0, 7) === m).reduce((s, r) => s + r.amount, 0);
    const spent =
      expenses.filter((e) => e.forMonth === m).reduce((s, e) => s + e.amount, 0) +
      salary.filter((s) => s.month === m).reduce((s, p) => s + p.amount, 0);
    return { month: m, income, expense: spent, net: income - spent };
  });

  const inMonth = expenses.filter((e) => e.forMonth === month);
  const heads = new Map<string, number>();
  for (const e of inMonth) {
    const name = (e.categoryId && catName.get(e.categoryId)) || "Other";
    heads.set(name, (heads.get(name) ?? 0) + e.amount);
  }
  const salaryPaid = salary.filter((s) => s.month === month).reduce((s, p) => s + p.amount, 0);
  if (salaryPaid) heads.set(SALARY, (heads.get(SALARY) ?? 0) + salaryPaid);

  // Planned: recurring costs that fall in the month, and salary.
  const paidByRecurring = new Map<string, number>();
  for (const e of inMonth) if (e.recurringId) paidByRecurring.set(e.recurringId, (paidByRecurring.get(e.recurringId) ?? 0) + e.amount);
  const planned = recurringRows
    .filter((r) => !r.archivedAt && fallsIn(r, month))
    .map((r) => ({ id: r.id, name: r.name, expected: r.amount, paid: paidByRecurring.get(r.id) ?? 0 }));
  const salaryExpected = await expectedSalary(month);
  const current = trend.find((t) => t.month === month)!;
  const plannedTotal = planned.reduce((s, p) => s + p.expected, 0) + salaryExpected;
  const miscSpent = inMonth.filter((e) => !e.recurringId).reduce((s, e) => s + e.amount, 0);
  const feesExpected = invoices.reduce((s, i) => s + i.amount, 0);

  return {
    month,
    income: current.income,
    expense: current.expense,
    net: current.net,
    byHead: [...heads.entries()].sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({ name, amount })),
    planned,
    salary: { expected: salaryExpected, paid: salaryPaid },
    expected: {
      fees: feesExpected,
      costs: plannedTotal + miscSpent,
      net: feesExpected - (plannedTotal + miscSpent),
    },
    trend,
  };
}
