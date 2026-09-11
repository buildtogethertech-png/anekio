import { useMemo, useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Badge, Button, Card, Empty, PageHeader } from "./ui";
import { useRecord } from "../lib/record";
import { apiBase, webOrigin } from "../lib/api";
import { useSession } from "../lib/session";

type Subscription = NonNullable<NonNullable<ReturnType<typeof useRecord>["data"]>["subscription"]>;
type SubscriptionInvoice = Subscription["invoices"][number];

function dateLabel(value: string) {
  if (!value) return "Not set";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function money(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function toneFor(status: string): "ink" | "leaf" | "warn" | "danger" | "clay" {
  const normalized = status.toUpperCase();
  if (["ACTIVE", "PAID", "ISSUED"].includes(normalized)) return "leaf";
  if (["OVERDUE", "EXPIRED", "FAILED", "CANCELLED", "VOID", "INACTIVE"].includes(normalized)) return "danger";
  if (["TRIAL", "PARTIALLY_PAID", "PARTIAL", "PAUSED", "PENDING", "DRAFT"].includes(normalized)) return "warn";
  return "clay";
}

function statusLabel(status: string) {
  return status ? status.replaceAll("_", " ") : "Not set";
}

function resolveUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${webOrigin()}${url.startsWith("/") ? url : `/${url}`}`;
}

const PLAN_FEATURES = [
  "Student, parent, teacher, and office portals",
  "Fee invoices, receipts, reminders, and payment tracking",
  "Attendance, routine, exams, reports, and notices",
  "Admissions, documents, roles, and school settings",
];

export function SubscriptionBoard() {
  const { data } = useRecord();
  const { token } = useSession();
  const [message, setMessage] = useState("");
  const subscription = data?.subscription;
  const totals = useMemo(() => {
    const invoices = subscription?.invoices ?? [];
    return invoices.reduce(
      (sum, invoice) => ({
        total: sum.total + invoice.total,
        balance: sum.balance + invoice.balance,
        paid: sum.paid + invoice.paid,
      }),
      { total: 0, balance: 0, paid: 0 }
    );
  }, [subscription?.invoices]);

  async function openInvoicePrint(invoice: SubscriptionInvoice) {
    setMessage("");
    try {
      const res = await fetch(`${apiBase()}${invoice.printUrl}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const blob = await res.blob();
      if (!res.ok) throw new Error((await blob.text()) || "Could not open invoice.");
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const url = window.URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        window.setTimeout(() => window.URL.revokeObjectURL(url), 30000);
        return;
      }
      await Linking.openURL(`${apiBase()}${invoice.printUrl}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open invoice.");
    }
  }

  if (!subscription) {
    return (
      <View>
        <PageHeader title="Manage subscription" lede="Plan, renewal, and Anekio invoices." />
        <Empty title="Subscription details not linked" body="Ask Anekio support to link this school account to its subscription record." />
      </View>
    );
  }

  return (
    <View>
      <PageHeader title="Manage subscription" lede="Current plan, expiry, and invoices for this school." />

      <Card className="overflow-hidden">
        <View className="p-6">
          <View className="flex-row flex-wrap items-start justify-between gap-4">
            <View className="min-w-0 flex-1">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-3xl font-semibold text-ink-900">{subscription.plan}</Text>
                <Badge tone={toneFor(subscription.status)}>Current plan</Badge>
              </View>
              <Text className="mt-2 text-sm font-semibold text-ink-700">
                {money(subscription.amount)} · Expiry date: {dateLabel(subscription.renewalOn)}
              </Text>
            </View>
            <Button onPress={() => void Linking.openURL(resolveUrl(subscription.renewUrl))}>Renew plan</Button>
          </View>

          <View className="mt-5 border-t border-ink-100 pt-5">
            <Text className="text-lg font-semibold text-ink-900">Current plan features</Text>
            <View className="mt-3 gap-3">
              {PLAN_FEATURES.map((feature) => (
                <View key={feature} className="flex-row items-start gap-2">
                  <Ionicons name="checkmark-circle-outline" size={18} color="#16a34a" />
                  <Text className="min-w-0 flex-1 text-sm font-medium text-ink-800">{feature}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </Card>

      <View className="mt-5">
        <View className="mb-3 flex-row items-center justify-between gap-3">
          <Text className="text-lg font-semibold text-ink-900">Invoices</Text>
          <Text className="text-xs text-ink-700">{money(totals.paid)} paid</Text>
        </View>
        {message ? <Text className="mb-3 text-sm text-danger-700">{message}</Text> : null}
        {subscription.invoices.length ? (
          <Card className="overflow-hidden">
            {subscription.invoices.map((invoice, index) => (
              <View
                key={invoice.id}
                className={`min-h-[72px] flex-row items-center gap-3 px-4 py-3 ${index ? "border-t border-ink-100" : ""}`}
              >
                <View className="h-10 w-10 items-center justify-center rounded-md bg-blue-50">
                  <Ionicons name="receipt-outline" size={20} color="#1d4ed8" />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-ink-900">{invoice.number}</Text>
                  <Text className="mt-0.5 text-xs text-ink-700" numberOfLines={1}>
                    {invoice.description}
                  </Text>
                  <Text className="mt-0.5 text-xs text-ink-700">Due {dateLabel(invoice.dueDate)}</Text>
                </View>
                <View className="items-end gap-1">
                  <Badge tone={toneFor(invoice.status)}>{statusLabel(invoice.status)}</Badge>
                  <Text className="text-sm font-semibold text-ink-900">{money(invoice.total)}</Text>
                </View>
                <Button variant="ghost" onPress={() => void openInvoicePrint(invoice)}>View invoice</Button>
              </View>
            ))}
          </Card>
        ) : (
          <Empty title="No invoices yet" body="Anekio invoices will appear here after they are issued." />
        )}
      </View>

    </View>
  );
}
