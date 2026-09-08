import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import {
  addOrgNote,
  cancelSubscription,
  changeSubscriptionPlan,
  completeDemo,
  completeFollowUp,
  createDemo,
  createFollowUp,
  createSupportTicket,
  createTrialSubscription,
  fulfillPaidSubscription,
  setPipelineStage,
  startOnboarding,
  toggleOnboardingTask,
} from "./saas-crm";

type UnknownRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function integer(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function optionalDate(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Enter a valid date.");
  return date;
}

function requiredDate(value: unknown, label: string) {
  const date = optionalDate(value);
  if (!date) throw new Error(`${label} is required.`);
  return date;
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

async function audit(actorEmail: string, action: string, input: { orgId?: string; entityType?: string; entityId?: string; detail?: string }) {
  return prisma.saasAuditEvent.create({
    data: {
      actorEmail,
      action,
      orgId: input.orgId || null,
      entityType: input.entityType || "",
      entityId: input.entityId || "",
      detail: input.detail || "",
    },
  });
}

export async function createAdminOrganisation(input: UnknownRecord, actorEmail: string) {
  const schoolName = text(input.schoolName);
  const ownerName = text(input.ownerName);
  const ownerEmail = text(input.ownerEmail).toLowerCase();
  const ownerPhone = text(input.ownerPhone);
  if (!schoolName || !ownerName || !ownerEmail || !ownerPhone) {
    throw new Error("Organisation, contact name, email, and phone are required.");
  }
  const duplicate = await prisma.saasOrg.findFirst({
    where: { OR: [{ schoolName }, { ownerEmail }, { ownerPhone }] },
  });
  if (duplicate) throw new Error(`A possible duplicate already exists: ${duplicate.schoolName}.`);
  const org = await prisma.saasOrg.create({
    data: {
      schoolName,
      ownerName,
      ownerEmail,
      ownerPhone,
      city: text(input.city),
      teacherCount: text(input.teacherCount) ? integer(input.teacherCount) : null,
      studentCount: text(input.studentCount) ? integer(input.studentCount) : null,
      subscriptionStatus: text(input.subscriptionStatus, "LEAD").toUpperCase(),
      plan: text(input.plan, "Monthly school"),
      monthlyPrice: integer(input.monthlyPrice, 14999),
      assignedOwner: text(input.assignedOwner),
      followUpStatus: text(input.followUpStatus, "NEW").toUpperCase(),
      nextFollowUpOn: optionalDate(input.nextFollowUpOn),
      billingAddress: text(input.billingAddress),
      billingState: text(input.billingState),
      billingPincode: text(input.billingPincode),
      gstin: text(input.gstin).toUpperCase(),
      notes: text(input.notes),
      source: text(input.source, "MANUAL").toUpperCase(),
      pipelineStage: text(input.pipelineStage, "NEW").toUpperCase(),
      lifecycle: text(input.lifecycle, text(input.subscriptionStatus, "LEAD")).toUpperCase(),
      interestedIn: text(input.interestedIn),
      subscriptionStart: optionalDate(input.subscriptionStart),
      renewalOn: optionalDate(input.renewalOn),
    },
  });
  await audit(actorEmail, "ORGANISATION_CREATED", { orgId: org.id, entityType: "ORGANISATION", entityId: org.id, detail: org.schoolName });
  if (org.lifecycle === "TRIAL") await createTrialSubscription(org.id);
  return org;
}

export async function updateAdminOrganisation(id: string, input: UnknownRecord, actorEmail: string) {
  const existing = await prisma.saasOrg.findUnique({ where: { id } });
  if (!existing) throw new Error("Organisation not found.");
  const schoolName = text(input.schoolName);
  const ownerName = text(input.ownerName);
  const ownerEmail = text(input.ownerEmail).toLowerCase();
  const ownerPhone = text(input.ownerPhone);
  if (!schoolName || !ownerName || !ownerEmail || !ownerPhone) {
    throw new Error("Organisation, contact name, email, and phone are required.");
  }
  const org = await prisma.saasOrg.update({
    where: { id },
    data: {
      schoolName,
      ownerName,
      ownerEmail,
      ownerPhone,
      city: text(input.city),
      teacherCount: text(input.teacherCount) ? integer(input.teacherCount) : null,
      studentCount: text(input.studentCount) ? integer(input.studentCount) : null,
      subscriptionStatus: text(input.subscriptionStatus, existing.subscriptionStatus).toUpperCase(),
      plan: text(input.plan, existing.plan),
      monthlyPrice: integer(input.monthlyPrice, existing.monthlyPrice),
      assignedOwner: text(input.assignedOwner),
      followUpStatus: text(input.followUpStatus, existing.followUpStatus).toUpperCase(),
      nextFollowUpOn: optionalDate(input.nextFollowUpOn),
      billingAddress: text(input.billingAddress),
      billingState: text(input.billingState),
      billingPincode: text(input.billingPincode),
      gstin: text(input.gstin).toUpperCase(),
      notes: text(input.notes),
      loginUrl: text(input.loginUrl),
      apiUrl: text(input.apiUrl),
      source: text(input.source, existing.source).toUpperCase(),
      pipelineStage: text(input.pipelineStage, existing.pipelineStage).toUpperCase(),
      lifecycle: text(input.lifecycle, existing.lifecycle).toUpperCase(),
      interestedIn: text(input.interestedIn, existing.interestedIn),
      subscriptionStart: optionalDate(input.subscriptionStart),
      renewalOn: optionalDate(input.renewalOn),
    },
  });
  await audit(actorEmail, "ORGANISATION_UPDATED", { orgId: id, entityType: "ORGANISATION", entityId: id, detail: org.schoolName });
  return org;
}

export async function createAdminInvoice(orgId: string, input: UnknownRecord, actorEmail: string) {
  const org = await prisma.saasOrg.findUnique({ where: { id: orgId } });
  if (!org) throw new Error("Organisation not found.");
  const description = text(input.description);
  const quantity = Math.max(1, integer(input.quantity, 1));
  const unitPrice = integer(input.unitPrice);
  const taxPercent = Math.min(100, integer(input.taxPercent));
  if (!description || !unitPrice) throw new Error("Invoice description and unit price are required.");
  const issueDate = requiredDate(input.issueDate, "Invoice date");
  const dueDate = requiredDate(input.dueDate, "Due date");
  if (dueDate < issueDate) throw new Error("Due date cannot be before the invoice date.");
  const subtotal = quantity * unitPrice;
  const taxAmount = Math.round((subtotal * taxPercent) / 100);
  const invoice = await prisma.saasInvoice.create({
    data: {
      orgId,
      number: `DRAFT-${Date.now()}-${randomBytes(3).toString("hex")}`,
      issueDate,
      dueDate,
      description,
      quantity,
      unitPrice,
      taxPercent,
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
      notes: text(input.notes),
    },
  });
  await audit(actorEmail, "INVOICE_DRAFT_CREATED", { orgId, entityType: "INVOICE", entityId: invoice.id, detail: money(invoice.total) });
  return invoice;
}

function invoiceNumber(sequence: number, date = new Date()) {
  const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(date);
  return `ANE-${year}-${String(sequence).padStart(4, "0")}`;
}

export async function issueAdminInvoice(id: string, actorEmail: string) {
  const invoice = await prisma.saasInvoice.findUnique({ where: { id } });
  if (!invoice) throw new Error("Invoice not found.");
  if (invoice.status !== "DRAFT") throw new Error("Only a draft invoice can be issued.");
  const issuedCount = await prisma.saasInvoice.count({ where: { status: { not: "DRAFT" } } });
  const issued = await prisma.saasInvoice.update({
    where: { id },
    data: { number: invoiceNumber(issuedCount + 1), status: "ISSUED", issuedAt: new Date() },
  });
  await audit(actorEmail, "INVOICE_ISSUED", { orgId: issued.orgId, entityType: "INVOICE", entityId: id, detail: issued.number });
  return issued;
}

export async function recordAdminPayment(invoiceId: string, input: UnknownRecord, actorEmail: string) {
  const invoice = await prisma.saasInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new Error("Invoice not found.");
  if (["DRAFT", "VOID", "PAID"].includes(invoice.status)) throw new Error("This invoice cannot accept a payment.");
  const amount = integer(input.amount);
  const outstanding = Math.max(0, invoice.total - invoice.paidAmount);
  if (!amount) throw new Error("Payment amount must be greater than zero.");
  if (amount > outstanding) throw new Error(`Payment cannot exceed the outstanding amount of ${money(outstanding)}.`);
  const reference = text(input.reference);
  if (reference) {
    const duplicate = await prisma.saasPayment.findFirst({ where: { paymentId: reference } });
    if (duplicate) throw new Error("A payment with this reference already exists.");
  }
  const nextPaid = invoice.paidAmount + amount;
  const status = nextPaid >= invoice.total ? "PAID" : "PARTIALLY_PAID";
  const paidAt = requiredDate(input.paidAt, "Payment date");
  return prisma.$transaction(async (tx) => {
    const payment = await tx.saasPayment.create({
      data: {
        orgId: invoice.orgId,
        invoiceId,
        amount,
        provider: text(input.method, "BANK_TRANSFER").toUpperCase(),
        paymentId: reference || null,
        status: "PAID",
        notes: text(input.notes),
        paidAt,
      },
    });
    await tx.saasInvoice.update({ where: { id: invoiceId }, data: { paidAmount: nextPaid, status } });
    await tx.saasOrg.update({
      where: { id: invoice.orgId },
      data: { paymentStatus: status === "PAID" ? "PAID" : "PARTIAL", subscriptionStatus: status === "PAID" ? "ACTIVE" : undefined },
    });
    await tx.saasAuditEvent.create({
      data: { orgId: invoice.orgId, actorEmail, action: "PAYMENT_RECORDED", entityType: "PAYMENT", entityId: payment.id, detail: `${money(amount)} · ${reference || payment.provider}` },
    });
    return payment;
  }).then(async (payment) => {
    if (status === "PAID") {
      await fulfillPaidSubscription({
        orgId: invoice.orgId,
        amount: invoice.total,
        plan: invoice.description,
        actorEmail,
        paymentId: payment.paymentId || payment.id,
        invoiceId,
      });
    } else {
      await createFollowUp({
        orgId: invoice.orgId,
        dueOn: new Date(),
        title: "Payment incomplete",
        nextAction: "Collect the remaining balance",
        reason: "PAYMENT_PARTIAL",
        actorEmail,
      });
    }
    return payment;
  });
}

function optionalDateTime(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error("Enter a valid date and time.");
  return date;
}

export async function runAdminCrmAction(kind: string, id: string, input: UnknownRecord, actorEmail: string) {
  if (kind === "stage") return setPipelineStage(id, text(input.stage), actorEmail);
  if (kind === "notes") return addOrgNote(id, text(input.note), actorEmail);
  if (kind === "demos") {
    const scheduledAt = optionalDateTime(input.scheduledAt);
    if (!scheduledAt) throw new Error("Demo time is required.");
    return createDemo(id, { scheduledAt, assignedTo: text(input.assignedTo), notes: text(input.notes) }, actorEmail);
  }
  if (kind === "demo-complete") return completeDemo(id, actorEmail);
  if (kind === "followups") {
    const dueOn = optionalDate(input.dueOn);
    if (!dueOn) throw new Error("Follow-up date is required.");
    return createFollowUp({ orgId: id, dueOn, title: text(input.title, "Follow up"), nextAction: text(input.nextAction, text(input.title)), actorEmail });
  }
  if (kind === "followup-done") return completeFollowUp(id, actorEmail);
  if (kind === "onboarding-start") return startOnboarding(id, actorEmail);
  if (kind === "onboarding-toggle") return toggleOnboardingTask(id, text(input.key) || text(input.taskKey), actorEmail);
  if (kind === "plan") return changeSubscriptionPlan(id, text(input.plan, "Launch"), integer(input.amount), actorEmail);
  if (kind === "cancel") return cancelSubscription(id, actorEmail);
  if (kind === "support") return createSupportTicket(text(input.orgId) || id, text(input.subject), text(input.body), actorEmail);
  throw new Error("Unknown CRM action.");
}

export { adminInvoicePrintHtml, adminLoginHtml, adminPortalHtml } from "./saas-admin-portal";
