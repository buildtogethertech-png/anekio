import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { api, type Notice } from "./api";
import { act } from "./mutate";
import { useSession } from "./session";
import { getSeenNoticeIds, setSeenNoticeIds } from "./storage";

type Inbox = {
  notices: Notice[];
  unread: number;
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  isSeen: (id: string) => boolean;
  markSeen: (id: string) => Promise<void>;
  markAllSeen: () => Promise<void>;
};

const InboxContext = createContext<Inbox | null>(null);

type NotificationsMod = typeof import("expo-notifications");

async function notifications(): Promise<NotificationsMod | null> {
  // Remote push is unavailable in Expo Go and importing the module there
  // produces a persistent development warning. Real app builds still load it.
  if (Platform.OS !== "web" && (Constants as { appOwnership?: string }).appOwnership === "expo") return null;
  try {
    return await import("expo-notifications");
  } catch {
    return null;
  }
}

function showWebNotice(title: string, body: string) {
  if (Platform.OS !== "web" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  new Notification(title, { body });
}

async function showDeviceNotice(title: string, body: string) {
  if (Platform.OS === "web") {
    showWebNotice(title, body);
    return;
  }
  const Notifications = await notifications();
  if (!Notifications) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { kind: "notice" } },
      trigger: null,
    });
  } catch {
    /* Expo Go / web — badge still updates */
  }
}

async function registerPush(token: string) {
  if (Platform.OS === "web") {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    return;
  }
  const Notifications = await notifications();
  if (!Notifications) return;
  try {
    const existing = await Notifications.getPermissionsAsync();
    const next = existing.status === "granted" ? existing : await Notifications.requestPermissionsAsync();
    if (next.status !== "granted") return;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("notices", {
        name: "Notices",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    const expoToken = projectId
      ? (await Notifications.getExpoPushTokenAsync({ projectId })).data
      : (await Notifications.getExpoPushTokenAsync()).data;
    await act(token, "savePushToken", { token: expoToken });
  } catch {
    /* Expo Go cannot register remote push — local + badge still work */
  }
}

export function NoticeInboxProvider({ children }: { children: ReactNode }) {
  const { token, user } = useSession();
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const primed = useRef(false);
  const known = useRef<Set<string>>(new Set());
  const seenRef = useRef(seen);
  seenRef.current = seen;

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!token || !user) return;
      const payload = await api<{ notices: Notice[] }>("/notices", token);
      const rows = payload.notices;
      if (!primed.current) {
        const stored = await getSeenNoticeIds(user.id);
        const nextSeen = stored ? new Set(stored) : new Set(rows.map((n) => n.id));
        if (!stored) await setSeenNoticeIds(user.id, [...nextSeen]);
        setSeen(nextSeen);
        known.current = new Set(rows.map((n) => n.id));
        primed.current = true;
        setNotices(rows);
        return;
      }
      const fresh = rows.filter((n) => !known.current.has(n.id));
      known.current = new Set(rows.map((n) => n.id));
      setNotices(rows);
      if (fresh.length && !opts?.silent) {
        const first = fresh[0];
        await showDeviceNotice(
          first.title,
          fresh.length > 1 ? `${fresh.length} new notices` : first.body.slice(0, 140)
        );
      }
    },
    [token, user]
  );

  const markAllSeen = useCallback(async () => {
    if (!user) return;
    const next = new Set([...seenRef.current, ...known.current]);
    setSeen(next);
    await setSeenNoticeIds(user.id, [...next]);
  }, [user]);

  const markSeen = useCallback(async (id: string) => {
    if (!user || !id) return;
    const next = new Set(seenRef.current);
    next.add(id);
    setSeen(next);
    await setSeenNoticeIds(user.id, [...next]);
  }, [user]);

  const isSeen = useCallback((id: string) => seenRef.current.has(id), []);

  useEffect(() => {
    primed.current = false;
    known.current = new Set();
    setNotices([]);
    setSeen(new Set());
    if (!token || !user) return;
    refresh({ silent: true }).catch(() => undefined);
    registerPush(token).catch(() => undefined);
  }, [refresh, token, user]);

  useEffect(() => {
    if (!token || !user) return;
    const tick = () => refresh().catch(() => undefined);
    const id = setInterval(tick, 15000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [refresh, token, user]);

  useEffect(() => {
    let tap: { remove: () => void } | undefined;
    let incoming: { remove: () => void } | undefined;
    notifications().then((Notifications) => {
      if (!Notifications) return;
      try {
        void Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
          }),
        });
        tap = Notifications.addNotificationResponseReceivedListener(() => {
          router.replace("/");
        });
        incoming = Notifications.addNotificationReceivedListener(() => {
          refresh({ silent: true }).catch(() => undefined);
        });
      } catch {
        /* Expo Go */
      }
    });
    return () => {
      tap?.remove();
      incoming?.remove();
    };
  }, [refresh, router]);

  const unread = notices.filter((n) => !seen.has(n.id)).length;
  const value = useMemo<Inbox>(
    () => ({ notices, unread, refresh, isSeen, markSeen, markAllSeen }),
    [notices, unread, refresh, isSeen, markSeen, markAllSeen]
  );
  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useNoticeInbox() {
  return useContext(InboxContext);
}
