import { prisma } from "./prisma";

export const PRICING_ID = "anekio";

export type SitePricing = {
  planName: string;
  listPrice: number;
  discountOn: boolean;
  discountType: "AMOUNT" | "PERCENT";
  discountValue: number;
  salePrice: number;
  saveAmount: number;
  savePercent: number;
  offerLabel: string;
  billingPeriod: string;
  trialDays: number;
};

const FALLBACK: Omit<SitePricing, "salePrice" | "saveAmount" | "savePercent"> = {
  planName: "Launch",
  listPrice: 29999,
  discountOn: true,
  discountType: "AMOUNT",
  discountValue: 15000,
  offerLabel: "Early bird",
  billingPeriod: "year",
  trialDays: 7,
};

export function computeSitePricing(input: {
  planName?: string;
  listPrice?: number;
  discountOn?: boolean;
  discountType?: string;
  discountValue?: number;
  offerLabel?: string;
  billingPeriod?: string;
  trialDays?: number;
}): SitePricing {
  const listPrice = Math.max(0, Math.round(Number(input.listPrice) || FALLBACK.listPrice));
  const discountOn = Boolean(input.discountOn);
  const discountType = input.discountType === "PERCENT" ? "PERCENT" : "AMOUNT";
  const discountValue = Math.max(0, Math.round(Number(input.discountValue) || 0));
  let salePrice = listPrice;
  if (discountOn && discountValue > 0) {
    salePrice =
      discountType === "PERCENT"
        ? Math.round(listPrice * (1 - Math.min(100, discountValue) / 100))
        : listPrice - discountValue;
  }
  salePrice = Math.max(0, Math.min(listPrice, salePrice));
  const saveAmount = Math.max(0, listPrice - salePrice);
  const savePercent = listPrice ? Math.round((saveAmount / listPrice) * 100) : 0;
  return {
    planName: String(input.planName || FALLBACK.planName).trim() || FALLBACK.planName,
    listPrice,
    discountOn,
    discountType,
    discountValue,
    salePrice,
    saveAmount,
    savePercent,
    offerLabel: String(input.offerLabel ?? FALLBACK.offerLabel).trim(),
    billingPeriod: String(input.billingPeriod || FALLBACK.billingPeriod).trim() || "year",
    trialDays: Math.max(1, Math.round(Number(input.trialDays) || FALLBACK.trialDays)),
  };
}

export async function getSitePricing(): Promise<SitePricing> {
  const row = await prisma.saasSitePricing.upsert({
    where: { id: PRICING_ID },
    create: { id: PRICING_ID, ...FALLBACK },
    update: {},
  });
  return computeSitePricing(row);
}

export async function updateSitePricing(input: Record<string, unknown>, actorEmail: string) {
  const next = computeSitePricing({
    planName: String(input.planName || ""),
    listPrice: Number(input.listPrice),
    discountOn: input.discountOn === "on" || input.discountOn === true || input.discountOn === "true" || input.discountOn === "1",
    discountType: String(input.discountType || "AMOUNT"),
    discountValue: Number(input.discountValue),
    offerLabel: String(input.offerLabel || ""),
    billingPeriod: String(input.billingPeriod || "year"),
    trialDays: Number(input.trialDays),
  });
  await prisma.saasSitePricing.upsert({
    where: { id: PRICING_ID },
    create: {
      id: PRICING_ID,
      planName: next.planName,
      listPrice: next.listPrice,
      discountOn: next.discountOn,
      discountType: next.discountType,
      discountValue: next.discountValue,
      offerLabel: next.offerLabel,
      billingPeriod: next.billingPeriod,
      trialDays: next.trialDays,
    },
    update: {
      planName: next.planName,
      listPrice: next.listPrice,
      discountOn: next.discountOn,
      discountType: next.discountType,
      discountValue: next.discountValue,
      offerLabel: next.offerLabel,
      billingPeriod: next.billingPeriod,
      trialDays: next.trialDays,
    },
  });
  await prisma.saasAuditEvent.create({
    data: {
      actorEmail,
      action: "SITE_PRICING_UPDATED",
      entityType: "PRICING",
      entityId: PRICING_ID,
      detail: `${next.planName} · list ₹${next.listPrice} · sale ₹${next.salePrice}`,
    },
  });
  return next;
}
