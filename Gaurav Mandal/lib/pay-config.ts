import { prisma } from "./prisma";

export const PAY_GATEWAYS = [
  { id: "NONE", label: "None", hint: "Cash, UPI, and bank only" },
  { id: "RAZORPAY", label: "Razorpay", hint: "School's own Razorpay account" },
  { id: "CASHFREE", label: "Cashfree", hint: "School's own Cashfree account" },
  { id: "BILLDESK", label: "BillDesk", hint: "School's own BillDesk merchant" },
] as const;

export type PayGateway = (typeof PAY_GATEWAYS)[number]["id"];

export type SchoolPaySecrets = {
  gateway: PayGateway;
  testMode: boolean;
  razorpayKeyId: string;
  razorpayKeySecret: string;
  razorpayWebhookSecret: string;
  cashfreeAppId: string;
  cashfreeSecretKey: string;
  billdeskMerchantId: string;
  billdeskClientId: string;
  billdeskSecret: string;
  aisensyApiKey: string;
  aisensyCampaign: string;
  resendApiKey: string;
  resendFromEmail: string;
};

export type SchoolPayForm = {
  gateway: PayGateway;
  testMode: boolean;
  razorpayKeyId: string;
  razorpaySecretSet: boolean;
  razorpayWebhookSet: boolean;
  cashfreeAppId: string;
  cashfreeSecretSet: boolean;
  billdeskMerchantId: string;
  billdeskClientId: string;
  billdeskSecretSet: boolean;
  aisensyKeySet: boolean;
  aisensyCampaign: string;
  resendKeySet: boolean;
  resendFromEmail: string;
};

const EMPTY_SECRETS: SchoolPaySecrets = {
  gateway: "NONE",
  testMode: true,
  razorpayKeyId: "",
  razorpayKeySecret: "",
  razorpayWebhookSecret: "",
  cashfreeAppId: "",
  cashfreeSecretKey: "",
  billdeskMerchantId: "",
  billdeskClientId: "",
  billdeskSecret: "",
  aisensyApiKey: "",
  aisensyCampaign: "fee_reminder",
  resendApiKey: "",
  resendFromEmail: "",
};

function asGateway(value?: string | null): PayGateway {
  return PAY_GATEWAYS.some((g) => g.id === value) ? (value as PayGateway) : "NONE";
}

export function paySecretsFromRow(row?: Partial<SchoolPaySecrets> | null): SchoolPaySecrets {
  return {
    gateway: asGateway(row?.gateway ?? (row as { payGateway?: string } | null)?.payGateway),
    testMode: row?.testMode ?? (row as { payTestMode?: boolean } | null)?.payTestMode ?? true,
    razorpayKeyId: row?.razorpayKeyId?.trim() || "",
    razorpayKeySecret: row?.razorpayKeySecret?.trim() || "",
    razorpayWebhookSecret: row?.razorpayWebhookSecret?.trim() || "",
    cashfreeAppId: row?.cashfreeAppId?.trim() || "",
    cashfreeSecretKey: row?.cashfreeSecretKey?.trim() || "",
    billdeskMerchantId: row?.billdeskMerchantId?.trim() || "",
    billdeskClientId: row?.billdeskClientId?.trim() || "",
    billdeskSecret: row?.billdeskSecret?.trim() || "",
    aisensyApiKey: row?.aisensyApiKey?.trim() || "",
    aisensyCampaign: row?.aisensyCampaign?.trim() || "fee_reminder",
    resendApiKey: row?.resendApiKey?.trim() || "",
    resendFromEmail: row?.resendFromEmail?.trim() || "",
  };
}

export function payFormFromSecrets(secrets: SchoolPaySecrets): SchoolPayForm {
  return {
    gateway: secrets.gateway,
    testMode: secrets.testMode,
    razorpayKeyId: secrets.razorpayKeyId,
    razorpaySecretSet: Boolean(secrets.razorpayKeySecret),
    razorpayWebhookSet: Boolean(secrets.razorpayWebhookSecret),
    cashfreeAppId: secrets.cashfreeAppId,
    cashfreeSecretSet: Boolean(secrets.cashfreeSecretKey),
    billdeskMerchantId: secrets.billdeskMerchantId,
    billdeskClientId: secrets.billdeskClientId,
    billdeskSecretSet: Boolean(secrets.billdeskSecret),
    aisensyKeySet: Boolean(secrets.aisensyApiKey),
    aisensyCampaign: secrets.aisensyCampaign || "fee_reminder",
    resendKeySet: Boolean(secrets.resendApiKey),
    resendFromEmail: secrets.resendFromEmail,
  };
}

export function gatewayReady(secrets: SchoolPaySecrets) {
  if (secrets.gateway === "RAZORPAY") {
    return Boolean(secrets.razorpayKeyId && secrets.razorpayKeySecret);
  }
  if (secrets.gateway === "CASHFREE") {
    return Boolean(secrets.cashfreeAppId && secrets.cashfreeSecretKey);
  }
  if (secrets.gateway === "BILLDESK") {
    return Boolean(secrets.billdeskMerchantId && secrets.billdeskClientId && secrets.billdeskSecret);
  }
  return false;
}

export function gatewayLabel(gateway: PayGateway) {
  return PAY_GATEWAYS.find((g) => g.id === gateway)?.label || "Online";
}

export async function getSchoolPaySecrets(): Promise<SchoolPaySecrets> {
  const row = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const secrets = row
    ? paySecretsFromRow({
        gateway: asGateway(row.payGateway),
        testMode: row.payTestMode,
        razorpayKeyId: row.razorpayKeyId,
        razorpayKeySecret: row.razorpayKeySecret,
        razorpayWebhookSecret: row.razorpayWebhookSecret,
        cashfreeAppId: row.cashfreeAppId,
        cashfreeSecretKey: row.cashfreeSecretKey,
        billdeskMerchantId: row.billdeskMerchantId,
        billdeskClientId: row.billdeskClientId,
        billdeskSecret: row.billdeskSecret,
        aisensyApiKey: row.aisensyApiKey,
        aisensyCampaign: row.aisensyCampaign,
        resendApiKey: row.resendApiKey,
        resendFromEmail: row.resendFromEmail,
      })
    : { ...EMPTY_SECRETS };
  const envKey = process.env.RAZORPAY_KEY_ID?.trim() || "";
  const envSecret = process.env.RAZORPAY_KEY_SECRET?.trim() || "";
  if (envKey && envSecret && (!secrets.razorpayKeyId || !secrets.razorpayKeySecret)) {
    secrets.razorpayKeyId = envKey;
    secrets.razorpayKeySecret = envSecret;
    secrets.razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || secrets.razorpayWebhookSecret;
    if (secrets.gateway === "NONE") secrets.gateway = "RAZORPAY";
  }
  return secrets;
}

export async function getSchoolPayForm() {
  return payFormFromSecrets(await getSchoolPaySecrets());
}
