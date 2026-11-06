/**
 * School day (first version, phone only — nothing is sent to the server yet).
 *
 * The day starts by itself when the teacher's own check-in is marked (or with "Start day"). The app
 * keeps working as usual, with a small bar on top. On Android, any other app is covered by a guard:
 *   - during one of the teacher's classes: no break at all ("Your class is on"),
 *   - in free time: "Take a break" with a reason; a break ends by itself when a class starts.
 * The day ends with "End day" or after the last period. The phone keeps the day natively
 * (modules/class-lock), so it works with Anekio in the background or after a restart.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { ClassLock } from "../modules/class-lock";
import { act } from "./mutate";
import { useRecord } from "./record";
import { useSession } from "./session";
import { getFocusDay, setFocusDay } from "./storage";

export type FocusEvent = {
  type: "start" | "break" | "resume" | "class_started" | "guard_off" | "outside" | "end" | "auto_end";
  at: number;
  reason?: string;
};

export type FocusDay = {
  userId: string;
  date: string;
  status: "focus" | "break" | "ended";
  startedAt: number;
  /** Focus time before the current focus stretch. */
  focusMs: number;
  /** When the current focus stretch (or break) started. */
  since: number;
  breakReason?: string;
  log: FocusEvent[];
  /** How many log entries the server already has. */
  synced?: number;
};

export type ClassPeriod = { key: string; classLabel: string; subject: string; room: string; period: string; start: number; end: number };

const DEFAULT_REASONS = ["Free period", "Lunch", "Personal call", "Office work"];

function ymdOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function today() {
  return ymdOf(new Date());
}

export function hms(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function clock(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
}

function minutes(hhmm: string | undefined) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** Focus time so far today (breaks not counted). */
export function focusTime(day: FocusDay, now: number) {
  return day.focusMs + (day.status === "focus" ? now - day.since : 0);
}

type TimetableLike = {
  periods: { id: string; name: string; start: string; end: string }[];
  slots: { weekday: number; periodId?: string; period: string; subject: string; classLabel?: string; room?: string }[];
} | null | undefined;

type DayChangeLike = { date: string; period: string; startsAt: string; classLabel: string; subject: string; kind: "COVER" | "AWAY" }[] | undefined;

/** The teacher's classes on a date: weekly routine, minus periods given away, plus covers. */
export function teacherPeriodsOn(date: Date, timetable: TimetableLike, dayChanges: DayChangeLike): ClassPeriod[] {
  if (!timetable) return [];
  const js = date.getDay();
  const weekday = js === 0 ? 7 : js;
  const ymd = ymdOf(date);
  const changes = (dayChanges ?? []).filter((c) => c.date === ymd);
  const away = new Set(changes.filter((c) => c.kind === "AWAY").map((c) => `${c.period}|${c.classLabel}`));
  const out: ClassPeriod[] = [];
  for (const slot of timetable.slots) {
    if (slot.weekday !== weekday || !slot.subject || slot.subject === "—") continue;
    if (away.has(`${slot.period}|${slot.classLabel || ""}`)) continue;
    const p = timetable.periods.find((x) => (slot.periodId && x.id === slot.periodId) || x.name === slot.period);
    const start = minutes(p?.start);
    const end = minutes(p?.end);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    out.push({ key: `${ymd}|${slot.period}|${slot.classLabel}`, classLabel: slot.classLabel || "", subject: slot.subject, room: slot.room || "", period: slot.period, start, end });
  }
  for (const c of changes.filter((x) => x.kind === "COVER")) {
    const p = timetable.periods.find((x) => x.name === c.period);
    const start = minutes(c.startsAt || p?.start);
    const end = minutes(p?.end);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    out.push({ key: `${ymd}|${c.period}|${c.classLabel}`, classLabel: c.classLabel, subject: c.subject || "Cover", room: "", period: c.period, start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** When the school day ends: a fixed "HH:MM" from the setting, else the end of the last period (16:00 without times). */
export function closingMinute(timetable: TimetableLike, endsAt = "last_period") {
  const fixed = minutes(endsAt);
  if (!Number.isNaN(fixed)) return fixed;
  const ends = (timetable?.periods ?? []).map((p) => minutes(p.end)).filter((m) => !Number.isNaN(m));
  return ends.length ? Math.max(...ends) : 16 * 60;
}

/** Pure state changes, so they can be tested without a phone. */
export const focusDay = {
  start(userId: string, now: number): FocusDay {
    return { userId, date: today(), status: "focus", startedAt: now, focusMs: 0, since: now, log: [{ type: "start", at: now }] };
  },
  takeBreak(day: FocusDay, now: number, reason: string): FocusDay {
    if (day.status !== "focus") return day;
    return { ...day, status: "break", breakReason: reason, focusMs: day.focusMs + (now - day.since), since: now, log: [...day.log, { type: "break", at: now, reason }] };
  },
  resume(day: FocusDay, now: number, why: "resume" | "class_started" = "resume"): FocusDay {
    if (day.status !== "break") return day;
    return { ...day, status: "focus", breakReason: undefined, since: now, log: [...day.log, { type: why, at: now }] };
  },
  end(day: FocusDay, now: number, why: "end" | "auto_end" = "end"): FocusDay {
    if (day.status === "ended") return day;
    const focusMs = day.focusMs + (day.status === "focus" ? now - day.since : 0);
    return { ...day, status: "ended", breakReason: undefined, focusMs, since: now, log: [...day.log, { type: why, at: now }] };
  },
  guardOff(day: FocusDay, now: number): FocusDay {
    return { ...day, log: [...day.log, { type: "guard_off", at: now }] };
  },
};

type FocusCtx = {
  enabled: boolean;
  day: FocusDay | null;
  now: number;
  /** One of the teacher's classes is on right now (no end day; no break unless the school allows it). */
  inClass: ClassPeriod | null;
  /** School setting: a break may be taken during a class. */
  breakInClass: boolean;
  /** Break reasons from the school setting, plus "Other". */
  reasons: string[];
  guardAllowed: boolean;
  allowGuard: () => void;
  startDay: () => void;
  askBreak: boolean;
  requestBreak: () => void;
  cancelBreak: () => void;
  takeBreak: (reason: string) => void;
  resume: () => void;
  endDay: () => void;
};

const Ctx = createContext<FocusCtx | null>(null);

export function FocusDayProvider({ children }: { children: ReactNode }) {
  const { data } = useRecord();
  const { user, token } = useSession();
  const rules = data?.schoolDay;
  // Android app only: the guard needs the native module, so web and iPhone never show the school day.
  const enabled = Platform.OS === "android" && ClassLock.available && data?.kind === "TEACHER" && Boolean(user?.id) && rules?.enabled === true;
  const breakInClass = rules?.breakDuringClass === "with_reason";
  const reasons = [...(rules?.breakReasons?.length ? rules.breakReasons : DEFAULT_REASONS), "Other"];
  const [day, setDay] = useState<FocusDay | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [askBreak, setAskBreak] = useState(false);
  const [guardAllowed, setGuardAllowed] = useState(() => ClassLock.canDrawOverlays());
  const timetable = data?.timetable as TimetableLike;

  const classes = useMemo(
    () => (enabled ? teacherPeriodsOn(new Date(), timetable, data?.dayChanges as DayChangeLike) : []),
    [enabled, timetable, data?.dayChanges]
  );
  const midnight = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }, [day?.date]);
  const closesAt = midnight + closingMinute(timetable, rules?.endsAt) * 60_000;
  const nowMin = (now - midnight) / 60_000;
  const inClass = day && day.status !== "ended" ? classes.find((c) => nowMin >= c.start && nowMin < c.end) || null : null;

  const save = useCallback((next: FocusDay | null) => {
    setDay(next);
    void setFocusDay(next ? JSON.stringify(next) : null);
  }, []);
  const update = useCallback((change: (cur: FocusDay) => FocusDay) => {
    setDay((cur) => {
      if (!cur) return cur;
      const next = change(cur);
      void setFocusDay(JSON.stringify(next));
      return next;
    });
  }, []);

  // Load today's day (one from an earlier date is dropped).
  useEffect(() => {
    if (!enabled || !user?.id) return;
    void getFocusDay().then((raw) => {
      try {
        const saved = raw ? (JSON.parse(raw) as FocusDay) : null;
        setDay(saved && saved.userId === user.id && saved.date === today() ? saved : null);
      } catch {
        setDay(null);
      }
      setLoaded(true);
    });
  }, [enabled, user?.id]);

  // The teacher's own check-in starts the day by itself (before closing time, once a day).
  const checkedIn = Boolean(data?.staffAttendanceSelf?.today?.marked);
  useEffect(() => {
    if (!enabled || !loaded || day || !checkedIn || !user?.id || Date.now() >= closesAt) return;
    save(focusDay.start(user.id, Date.now()));
  }, [enabled, loaded, day, checkedIn, user?.id, closesAt]);

  // Tick every second while the day is on: timer, class start, closing time.
  useEffect(() => {
    if (!day || day.status === "ended") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [day?.status]);

  useEffect(() => {
    if (!day || day.status === "ended") return;
    if (now >= closesAt) update((cur) => focusDay.end(cur, Date.now(), "auto_end"));
    else if (day.status === "break" && inClass && !breakInClass) update((cur) => focusDay.resume(cur, Date.now(), "class_started"));
  }, [now, closesAt, day?.status, Boolean(inClass), breakInClass]);

  // Hand the day to the phone (guard, notification, Recents, restart). School setting off = phone off.
  useEffect(() => {
    if (!ClassLock.available || !data) return;
    ClassLock.setDay({
      status: !enabled || !day || day.status === "ended" ? "off" : day.status,
      breakInClass,
      focusMs: day?.focusMs ?? 0,
      since: day?.since ?? Date.now(),
      closesAt,
      date: today(),
      classes: classes.map((c) => ({
        start: midnight + c.start * 60_000,
        end: midnight + c.end * 60_000,
        title: `${c.classLabel} · ${c.subject}`,
        subtitle: `${clock(c.start)} – ${clock(c.end)}${c.room ? ` · ${c.room}` : ""}`,
      })),
    });
  }, [enabled, Boolean(data), breakInClass, day?.status, day?.since, day?.focusMs, closesAt, classes, midnight]);

  // The phone changed the day on its own (class started during a break, school closed) while Anekio was away.
  useEffect(() => {
    if (!ClassLock.available) return;
    const sync = () => {
      const phone = ClassLock.getDay();
      // Anekio opened another app (WhatsApp, call, camera…): a short pass, logged (not a break).
      const outside = (phone?.outside ?? []).filter((t) => typeof t === "number");
      if (outside.length) {
        update((cur) => {
          const have = new Set(cur.log.filter((e) => e.type === "outside").map((e) => e.at));
          const add = outside.filter((t) => !have.has(t)).map((at) => ({ type: "outside" as const, at, reason: "Opened from Anekio" }));
          // Appended (not sorted in): the server sync sends the log from where it left off; the report orders by time.
          return add.length ? { ...cur, log: [...cur.log, ...add] } : cur;
        });
        ClassLock.clearOutside(Math.max(...outside));
      }
      if (!phone?.changedByPhone) return;
      if (phone.changedByPhone === "class") update((cur) => focusDay.resume(cur, phone.since, "class_started"));
      if (phone.changedByPhone === "closed") update((cur) => focusDay.end(cur, phone.since, "auto_end"));
      if (phone.changedByPhone === "resumed") update((cur) => focusDay.resume(cur, phone.since));
    };
    sync();
    const sub = ClassLock.onBreakRequest(() => setAskBreak(true));
    const app = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      setGuardAllowed(ClassLock.canDrawOverlays());
      sync();
    });
    return () => {
      sub.remove();
      app.remove();
    };
  }, []);

  // Send new log entries to the server (for the admin's Phone use report). Retried on every change
  // and when Anekio comes back; the server keeps each entry once.
  const sending = useRef(false);
  const sendLog = useCallback(() => {
    setDay((cur) => {
      if (!cur || sending.current) return cur;
      const from = cur.synced ?? 0;
      const pending = cur.log.slice(from);
      if (!pending.length || !token) return cur;
      sending.current = true;
      const upTo = cur.log.length;
      act(token, "logSchoolDay", {
        events: pending.map((e) => ({ id: `${cur.date}:${e.type}:${e.at}`, type: e.type, at: e.at, reason: e.reason || "", date: cur.date })),
      })
        .then(() =>
          setDay((latest) => {
            if (!latest || latest.date !== cur.date) return latest;
            const next = { ...latest, synced: Math.max(latest.synced ?? 0, upTo) };
            void setFocusDay(JSON.stringify(next));
            return next;
          })
        )
        .catch(() => undefined)
        .finally(() => {
          sending.current = false;
        });
      return cur;
    });
  }, [token]);
  useEffect(() => {
    if (enabled) sendLog();
  }, [enabled, day?.log.length, sendLog]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") sendLog();
    });
    return () => sub.remove();
  }, [sendLog]);

  // The guard permission was turned off during the day: only record it.
  const lastAllowed = useRef(guardAllowed);
  useEffect(() => {
    const was = lastAllowed.current;
    lastAllowed.current = guardAllowed;
    if (was && !guardAllowed && day && day.status !== "ended") update((cur) => focusDay.guardOff(cur, Date.now()));
  }, [guardAllowed]);

  const value: FocusCtx = {
    enabled,
    day,
    now,
    inClass,
    breakInClass,
    reasons,
    guardAllowed,
    allowGuard: () => ClassLock.openOverlaySettings(),
    startDay: () => {
      if (user?.id) save(focusDay.start(user.id, Date.now()));
    },
    askBreak: askBreak && (!inClass || breakInClass),
    requestBreak: () => {
      if (!inClass || breakInClass) setAskBreak(true);
    },
    cancelBreak: () => setAskBreak(false),
    takeBreak: (reason) => {
      setAskBreak(false);
      if (!inClass || breakInClass) update((cur) => focusDay.takeBreak(cur, Date.now(), reason));
    },
    resume: () => update((cur) => focusDay.resume(cur, Date.now())),
    endDay: () => {
      if (!inClass) update((cur) => focusDay.end(cur, Date.now()));
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFocusDay() {
  return useContext(Ctx);
}
