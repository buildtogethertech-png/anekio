import { prisma } from "./prisma";
import { getSitePricing } from "./saas-pricing";

export const PIPELINE_STAGES = ["NEW", "CONTACTED", "DEMO", "QUALIFIED", "PROPOSAL", "PAYMENT", "WON"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const ONBOARDING_STEPS = [
  { key: "account_created", label: "Account created" },
  { key: "admin_created", label: "Admin created" },
  { key: "school_details", label: "School details configured" },
  { key: "teachers_imported", label: "Teachers imported" },
  { key: "students_imported", label: "Students imported" },
  { key: "fees_configured", label: "Fees configured" },
  { key: "parent_accounts", label: "Parent accounts created" },
  { key: "training_completed", label: "Training completed" },
] as const;

const STAGE_FOLLOWUP: Record<string, { days: number; title: string; action: string }> = {
  NEW: { days: 1, title: "New lead", action: "Call the school" },
  CONTACTED: { days: 1, title: "Lead contacted", action: "Schedule a demo" },
  DEMO: { days: 1, title: "Demo booked", action: "Confirm demo attendance" },
  QUALIFIED: { days: 1, title: "Lead qualified", action: "Send a proposal" },
  PROPOSAL: { days: 2, title: "Proposal sent", action: "Follow up on the proposal" },
  PAYMENT: { days: 0, title: "Payment pending", action: "Help the school complete payment" },
};

function addDays(from: Date, days: number) {
  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addOneYear(from = new Date()) {
  const next = new Date(from);
  next.setFullYear(next.getFullYear() + 1);
  return next;
}

export function greetingFor(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(now)
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function firstName(email: string) {
  const local = email.split("@")[0] || "there";
  const token = local.split(/[._-]/)[0] || local;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

export function isCustomerOrg(org: { lifecycle: string; pipelineStage: string; subscriptionStatus: string }) {
  return org.lifecycle === "CUSTOMER" || org.pipelineStage === "WON" || ["ACTIVE", "PAUSED", "CANCELLED"].includes(org.subscriptionStatus);
}

export async function logCrm(actorEmail: string, action: string, input: { orgId?: string; entityType?: string; entityId?: string; detail?: string }) {
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

export async function ensureOnboardingTasks(orgId: string) {
  const existing = await prisma.saasOnboardingTask.findMany({ where: { orgId } });
  if (existing.length) return existing;
  await prisma.saasOnboardingTask.createMany({
    data: ONBOARDING_STEPS.map((step, index) => ({
      orgId,
      key: step.key,
      label: step.label,
      sortOrder: index,
      done: step.key === "account_created",
      doneAt: step.key === "account_created" ? new Date() : null,
    })),
  });
  return prisma.saasOnboardingTask.findMany({ where: { orgId }, orderBy: { sortOrder: "asc" } });
}

export async function refreshOnboardingProgress(orgId: string) {
  const tasks = await prisma.saasOnboardingTask.findMany({ where: { orgId } });
  if (!tasks.length) return;
  const done = tasks.filter((task) => task.done).length;
  const percent = Math.round((done / tasks.length) * 100);
  const status = percent >= 100 ? "COMPLETE" : percent > 0 ? "IN_PROGRESS" : "NOT_STARTED";
  await prisma.saasOrg.update({ where: { id: orgId }, data: { onboardingStatus: status } });
  return { percent, status, done, total: tasks.length };
}

export async function createFollowUp(input: {
  orgId: string;
  dueOn: Date;
  title: string;
  nextAction?: string;
  reason?: string;
  actorEmail?: string;
}) {
  const followUp = await prisma.saasFollowUp.create({
    data: {
      orgId: input.orgId,
      dueOn: input.dueOn,
      title: input.title,
      nextAction: input.nextAction || "",
      reason: input.reason || "",
    },
  });
  await prisma.saasOrg.update({
    where: { id: input.orgId },
    data: { nextFollowUpOn: input.dueOn },
  });
  if (input.actorEmail) {
    await logCrm(input.actorEmail, "FOLLOW_UP_CREATED", {
      orgId: input.orgId,
      entityType: "FOLLOW_UP",
      entityId: followUp.id,
      detail: input.title,
    });
  }
  return followUp;
}

export async function scheduleStageFollowUp(orgId: string, stage: string, actorEmail = "system") {
  const spec = STAGE_FOLLOWUP[stage];
  if (!spec) return null;
  return createFollowUp({
    orgId,
    dueOn: addDays(new Date(), spec.days),
    title: spec.title,
    nextAction: spec.action,
    reason: stage,
    actorEmail,
  });
}

export async function setPipelineStage(orgId: string, stage: string, actorEmail: string) {
  const next = PIPELINE_STAGES.includes(stage as PipelineStage) ? stage : "NEW";
  const lifecycle = next === "WON" ? "CUSTOMER" : next === "QUALIFIED" || next === "PROPOSAL" || next === "PAYMENT" ? "QUALIFIED" : undefined;
  const org = await prisma.saasOrg.update({
    where: { id: orgId },
    data: {
      pipelineStage: next,
      followUpStatus: next,
      lifecycle: lifecycle || undefined,
      subscriptionStatus: next === "WON" ? "ACTIVE" : undefined,
    },
  });
  await logCrm(actorEmail, "PIPELINE_MOVED", { orgId, entityType: "ORGANISATION", entityId: orgId, detail: next });
  await scheduleStageFollowUp(orgId, next, actorEmail);
  return org;
}

export async function createDemo(orgId: string, input: { scheduledAt: Date; assignedTo?: string; notes?: string }, actorEmail: string) {
  const demo = await prisma.saasDemo.create({
    data: {
      orgId,
      scheduledAt: input.scheduledAt,
      assignedTo: input.assignedTo || "",
      notes: input.notes || "",
    },
  });
  await prisma.saasOrg.update({
    where: { id: orgId },
    data: { pipelineStage: "DEMO", followUpStatus: "DEMO", nextFollowUpOn: input.scheduledAt },
  });
  await logCrm(actorEmail, "DEMO_SCHEDULED", {
    orgId,
    entityType: "DEMO",
    entityId: demo.id,
    detail: input.scheduledAt.toISOString(),
  });
  return demo;
}

export async function completeDemo(demoId: string, actorEmail: string) {
  const demo = await prisma.saasDemo.update({ where: { id: demoId }, data: { status: "COMPLETED" } });
  await logCrm(actorEmail, "DEMO_COMPLETED", { orgId: demo.orgId, entityType: "DEMO", entityId: demo.id });
  await createFollowUp({
    orgId: demo.orgId,
    dueOn: addDays(new Date(), 1),
    title: "Demo completed",
    nextAction: "Call the principal",
    reason: "DEMO_COMPLETED",
    actorEmail,
  });
  return demo;
}

export async function createTrialSubscription(orgId: string, days?: number) {
  const trialDays = days ?? (await getSitePricing()).trialDays;
  const startedAt = new Date();
  const renewsAt = addDays(startedAt, trialDays);
  const subscription = await prisma.saasSubscription.create({
    data: {
      orgId,
      plan: `${trialDays}-day free trial`,
      amount: 0,
      cycle: "TRIAL",
      status: "TRIAL",
      paymentStatus: "TRIAL",
      startedAt,
      renewsAt,
      history: "Trial started",
    },
  });
  await prisma.saasOrg.update({
    where: { id: orgId },
    data: {
      lifecycle: "TRIAL",
      subscriptionStatus: "TRIAL",
      paymentStatus: "TRIAL",
      pipelineStage: "QUALIFIED",
      followUpStatus: "QUALIFIED",
      plan: subscription.plan,
      monthlyPrice: 0,
      subscriptionStart: startedAt,
      renewalOn: renewsAt,
    },
  });
  await createFollowUp({
    orgId,
    dueOn: addDays(renewsAt, -2),
    title: "Trial ending",
    nextAction: "Follow up before trial expiry",
    reason: "TRIAL_ENDING",
    actorEmail: "system",
  });
  await logCrm("system", "TRIAL_STARTED", { orgId, entityType: "SUBSCRIPTION", entityId: subscription.id, detail: `${trialDays} days` });
  return subscription;
}

async function issuePaidInvoice(orgId: string, amount: number, plan: string, actorEmail: string) {
  const taxPercent = 18;
  const subtotal = Math.round(amount / (1 + taxPercent / 100));
  const taxAmount = amount - subtotal;
  const issuedCount = await prisma.saasInvoice.count({ where: { status: { not: "DRAFT" } } });
  const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date());
  const number = `ANE-${year}-${String(issuedCount + 1).padStart(4, "0")}`;
  const invoice = await prisma.saasInvoice.create({
    data: {
      orgId,
      number,
      status: "PAID",
      issueDate: new Date(),
      dueDate: new Date(),
      description: `${plan} subscription`,
      quantity: 1,
      unitPrice: subtotal,
      taxPercent,
      subtotal,
      taxAmount,
      total: amount,
      paidAmount: amount,
      issuedAt: new Date(),
    },
  });
  await logCrm(actorEmail, "INVOICE_ISSUED", { orgId, entityType: "INVOICE", entityId: invoice.id, detail: number });
  return invoice;
}

export async function fulfillPaidSubscription(input: {
  orgId: string;
  amount: number;
  plan?: string;
  actorEmail: string;
  paymentId?: string;
  invoiceId?: string;
}) {
  const org = await prisma.saasOrg.findUnique({ where: { id: input.orgId } });
  if (!org) throw new Error("Organisation not found.");
  const pricing = await getSitePricing();
  const plan = input.plan || org.plan || pricing.planName;
  const amount = input.amount || pricing.salePrice;
  const startedAt = new Date();
  const renewsAt = addOneYear(startedAt);
  await prisma.saasSubscription.updateMany({
    where: { orgId: org.id, status: { in: ["TRIAL", "ACTIVE"] } },
    data: { status: "SUPERSEDED" },
  });
  const subscription = await prisma.saasSubscription.create({
    data: {
      orgId: org.id,
      plan,
      amount: input.amount,
      cycle: "YEAR",
      status: "ACTIVE",
      paymentStatus: "PAID",
      startedAt,
      renewsAt,
      history: org.subscriptionStatus === "TRIAL" ? "Trial → Launch Plan → Payment successful → Activated" : "Payment successful → Activated",
    },
  });
  let invoiceId = input.invoiceId;
  if (!invoiceId) {
    const invoice = await issuePaidInvoice(org.id, input.amount, plan, input.actorEmail);
    invoiceId = invoice.id;
    if (input.paymentId) {
      await prisma.saasPayment.updateMany({ where: { paymentId: input.paymentId }, data: { invoiceId } });
    }
  }
  await ensureOnboardingTasks(org.id);
  await prisma.saasOrg.update({
    where: { id: org.id },
    data: {
      lifecycle: "CUSTOMER",
      pipelineStage: "WON",
      followUpStatus: "WON",
      subscriptionStatus: "ACTIVE",
      paymentStatus: "PAID",
      plan,
      monthlyPrice: input.amount,
      customerSince: org.customerSince || startedAt,
      subscriptionStart: org.subscriptionStart || startedAt,
      renewalOn: renewsAt,
      onboardingStatus: org.onboardingStatus === "COMPLETE" ? "COMPLETE" : "NOT_STARTED",
    },
  });
  await logCrm(input.actorEmail, "PAYMENT_RECEIVED", {
    orgId: org.id,
    entityType: "PAYMENT",
    entityId: input.paymentId || invoiceId || subscription.id,
    detail: `₹${input.amount.toLocaleString("en-IN")}`,
  });
  await logCrm(input.actorEmail, "SUBSCRIPTION_ACTIVATED", {
    orgId: org.id,
    entityType: "SUBSCRIPTION",
    entityId: subscription.id,
    detail: plan,
  });
  await logCrm(input.actorEmail, "DEAL_WON", { orgId: org.id, entityType: "ORGANISATION", entityId: org.id, detail: plan });
  await logCrm(input.actorEmail, "LEAD_CUSTOMER", { orgId: org.id, entityType: "ORGANISATION", entityId: org.id });
  await logCrm("system", "ONBOARDING_CREATED", { orgId: org.id, entityType: "ONBOARDING", entityId: org.id, detail: "NOT STARTED" });
  await createFollowUp({
    orgId: org.id,
    dueOn: addDays(new Date(), 1),
    title: "Start onboarding",
    nextAction: org.assignedOwner ? `Assign work for ${org.assignedOwner}` : "Assign an account manager",
    reason: "NEW_CUSTOMER",
    actorEmail: input.actorEmail,
  });
  await refreshOnboardingProgress(org.id);
  return { orgId: org.id, subscriptionId: subscription.id, invoiceId };
}

export async function toggleOnboardingTask(orgId: string, key: string, actorEmail: string) {
  const task = await prisma.saasOnboardingTask.findUnique({ where: { orgId_key: { orgId, key } } });
  if (!task) throw new Error("Onboarding task not found.");
  const done = !task.done;
  await prisma.saasOnboardingTask.update({
    where: { id: task.id },
    data: { done, doneAt: done ? new Date() : null },
  });
  await logCrm(actorEmail, done ? "ONBOARDING_STEP_DONE" : "ONBOARDING_STEP_REOPENED", {
    orgId,
    entityType: "ONBOARDING",
    entityId: task.id,
    detail: task.label,
  });
  return refreshOnboardingProgress(orgId);
}

export async function startOnboarding(orgId: string, actorEmail: string) {
  await ensureOnboardingTasks(orgId);
  await prisma.saasOrg.update({ where: { id: orgId }, data: { onboardingStatus: "IN_PROGRESS" } });
  await logCrm(actorEmail, "ONBOARDING_STARTED", { orgId, entityType: "ONBOARDING", entityId: orgId });
}

export async function completeFollowUp(id: string, actorEmail: string) {
  const followUp = await prisma.saasFollowUp.update({ where: { id }, data: { status: "DONE", doneAt: new Date() } });
  await logCrm(actorEmail, "FOLLOW_UP_DONE", { orgId: followUp.orgId, entityType: "FOLLOW_UP", entityId: id, detail: followUp.title });
  return followUp;
}

export async function addOrgNote(orgId: string, note: string, actorEmail: string) {
  const org = await prisma.saasOrg.findUnique({ where: { id: orgId } });
  if (!org) throw new Error("Organisation not found.");
  const notes = [org.notes, `${new Date().toISOString().slice(0, 10)} · ${actorEmail}: ${note}`].filter(Boolean).join("\n");
  await prisma.saasOrg.update({ where: { id: orgId }, data: { notes } });
  await logCrm(actorEmail, "NOTE_ADDED", { orgId, entityType: "ORGANISATION", entityId: orgId, detail: note });
}

export async function changeSubscriptionPlan(orgId: string, plan: string, amount: number, actorEmail: string) {
  const current = await prisma.saasSubscription.findFirst({
    where: { orgId, status: { in: ["ACTIVE", "TRIAL"] } },
    orderBy: { createdAt: "desc" },
  });
  if (current) {
    await prisma.saasSubscription.update({
      where: { id: current.id },
      data: { plan, amount, history: `${current.history}\nPlan changed to ${plan}` },
    });
  }
  await prisma.saasOrg.update({ where: { id: orgId }, data: { plan, monthlyPrice: amount } });
  await logCrm(actorEmail, "PLAN_CHANGED", { orgId, entityType: "SUBSCRIPTION", entityId: current?.id || orgId, detail: `${plan} · ₹${amount}` });
}

export async function cancelSubscription(orgId: string, actorEmail: string) {
  await prisma.saasSubscription.updateMany({
    where: { orgId, status: { in: ["ACTIVE", "TRIAL"] } },
    data: { status: "CANCELLED", cancelledAt: new Date(), paymentStatus: "CANCELLED" },
  });
  await prisma.saasOrg.update({ where: { id: orgId }, data: { subscriptionStatus: "CANCELLED" } });
  await logCrm(actorEmail, "SUBSCRIPTION_CANCELLED", { orgId, entityType: "SUBSCRIPTION", entityId: orgId });
}

export async function createSupportTicket(orgId: string, subject: string, body: string, actorEmail: string) {
  const ticket = await prisma.saasSupportTicket.create({ data: { orgId, subject, body } });
  await logCrm(actorEmail, "SUPPORT_TICKET_OPENED", { orgId, entityType: "SUPPORT", entityId: ticket.id, detail: subject });
  return ticket;
}

export async function captureWebsiteLead(orgId: string, kind: "DEMO" | "TRIAL") {
  const org = await prisma.saasOrg.findUnique({ where: { id: orgId } });
  if (!org) return;
  await prisma.saasOrg.update({
    where: { id: orgId },
    data: {
      source: kind === "TRIAL" ? "WEBSITE_TRIAL" : org.source === "MANUAL" ? "WEBSITE_DEMO" : org.source,
      pipelineStage: kind === "TRIAL" ? "QUALIFIED" : org.pipelineStage === "NEW" ? "NEW" : org.pipelineStage,
      lifecycle: kind === "TRIAL" ? "TRIAL" : org.lifecycle || "LEAD",
    },
  });
  if (kind === "TRIAL") {
    const existing = await prisma.saasSubscription.findFirst({ where: { orgId, status: "TRIAL" } });
    if (!existing) await createTrialSubscription(orgId);
  } else {
    await scheduleStageFollowUp(orgId, "NEW", "website");
    await logCrm("website", "LEAD_CREATED", { orgId, entityType: "ORGANISATION", entityId: orgId, detail: "Website — Book Demo" });
  }
}
