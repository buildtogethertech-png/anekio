import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { webOrigin } from "../lib/api";
import { useRecord } from "../lib/record";
import { getRenewalNoticeSeen, setRenewalNoticeSeen } from "../lib/storage";
import { Modal } from "./ui";

/** Days before the end date when the reminder pops up again after being closed. */
const MILESTONES = [30, 15, 7, 3, 1, 0];

function money(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function resolveUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${webOrigin()}${url.startsWith("/") ? url : `/${url}`}`;
}

/**
 * Office dashboard: renewal reminder for school admins (only they get `subscription` in the record).
 * A popup 30 / 15 / 7 / 3 / 1 days before the free trial or paid year ends, on the day, and after it ends
 * (closing it hides it until the next milestone). The banner on top of every screen is RenewalBanner.
 */
export function RenewalReminder() {
  const { data } = useRecord();
  const sub = data?.subscription;
  const [seen, setSeen] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const ended = Boolean(sub?.renewalOn) && new Date(sub!.renewalOn).getTime() < Date.now();
  const daysLeft = sub?.daysLeft ?? null;
  const milestone = !sub?.renewalOn
    ? ""
    : ended
      ? "ended"
      : daysLeft != null && daysLeft <= 30
        ? String(MILESTONES.filter((m) => daysLeft <= m).pop())
        : "";
  const key = sub && milestone ? `${sub.orgId}|${sub.renewalOn}|${milestone}` : "";

  useEffect(() => {
    let alive = true;
    void getRenewalNoticeSeen().then((value) => {
      if (alive) setSeen(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (key && seen !== null && seen !== key) setOpen(true);
  }, [key, seen]);

  if (!sub || !milestone) return null;

  const trial = sub.free;
  const grace = sub.graceDaysLeft ?? null;
  const title = ended
    ? trial
      ? "Your free trial has ended"
      : "Your Anekio plan has ended"
    : `${trial ? "Your free trial ends" : "Your Anekio plan renews"} ${daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}`;
  const body = ended
    ? grace
      ? `It ended on ${dateLabel(sub.renewalOn)}. The app locks in ${grace} day${grace === 1 ? "" : "s"}. Renew to keep fees, attendance and results running.`
      : `It ended on ${dateLabel(sub.renewalOn)}. Renew to keep fees, attendance and results running.`
    : `On ${dateLabel(sub.renewalOn)}. Renew now so fees, attendance and results keep running without a break.`;

  function close() {
    setOpen(false);
    setSeen(key);
    void setRenewalNoticeSeen(key);
  }

  function renew() {
    close();
    void Linking.openURL(resolveUrl(sub!.renewUrl));
  }

  return (
    <>
      <Modal open={open} title="" onClose={close}>
        <View className="items-center px-2 pb-2">
          <View className={`h-14 w-14 items-center justify-center rounded-full ${ended ? "bg-red-50" : "bg-[#EEF3FF]"}`}>
            <Ionicons name={ended ? "alert-circle-outline" : "calendar-outline"} size={26} color={ended ? "#B91C1C" : "#1F45C7"} />
          </View>
          <Text className="mt-3 text-center text-[19px] font-semibold text-ink-900">{title}</Text>
          <Text className="mt-1.5 text-center text-[13px] leading-5 text-ink-600">{body}</Text>
          {sub.amount > 0 ? (
            <View className="mt-4 items-center rounded-xl bg-ink-50 px-5 py-3">
              <Text className="text-[22px] font-bold text-ink-900">{money(sub.amount)}</Text>
              <Text className="text-[12px] text-ink-500">per year · {sub.schoolName}</Text>
            </View>
          ) : null}
          <Pressable accessibilityRole="button" onPress={renew} className="mt-5 w-full items-center rounded-xl bg-[#1F45C7] py-3 active:opacity-80">
            <Text className="text-[15px] font-semibold text-white">Renew now</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={close} className="mt-2 w-full items-center py-2.5" hitSlop={6}>
            <Text className="text-[14px] font-medium text-ink-600">Remind me later</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

/** Days before the end date when the banner appears on top of every screen. It cannot be closed. */
const BANNER_DAYS = 15;

/**
 * Admins only: a strip on top of every screen from 15 days before the plan ends until it is paid.
 * Tapping it opens checkout. Hidden once the app is locked (the lock screen takes over).
 */
export function RenewalBanner() {
  const { data } = useRecord();
  const sub = data?.subscription;
  if (!sub?.renewalOn || data?.subscriptionLock) return null;
  const ended = new Date(sub.renewalOn).getTime() < Date.now();
  const daysLeft = sub.daysLeft ?? null;
  if (!ended && (daysLeft == null || daysLeft > BANNER_DAYS)) return null;
  const grace = sub.graceDaysLeft ?? null;
  const what = sub.free ? "Free trial" : "Your plan";
  const text = ended
    ? `${what} ended on ${dateLabel(sub.renewalOn)}${grace != null ? ` · app locks in ${grace} day${grace === 1 ? "" : "s"}` : ""}`
    : `${what} ends ${daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`} · ${dateLabel(sub.renewalOn)}`;
  const urgent = ended || (daysLeft != null && daysLeft <= 5);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => void Linking.openURL(resolveUrl(sub.renewUrl))}
      className={`flex-row items-center gap-2.5 px-4 py-2.5 active:opacity-90 ${urgent ? "bg-red-600" : "bg-amber-500"}`}
    >
      <Ionicons name={ended ? "alert-circle" : "time-outline"} size={17} color="#fff" />
      <Text className="min-w-0 flex-1 text-[13px] font-semibold text-white" numberOfLines={2}>
        {text}
        {sub.amount > 0 ? ` · ${money(sub.amount)}/year` : ""}
      </Text>
      <View className="rounded-full bg-white px-3 py-1">
        <Text className={`text-[12px] font-bold ${urgent ? "text-red-700" : "text-amber-800"}`}>Renew now</Text>
      </View>
    </Pressable>
  );
}
