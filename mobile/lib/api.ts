import { NativeModules, Platform } from "react-native";
import Constants from "expo-constants";

function isLoopback(url: string) {
  return /localhost|127\.0\.0\.1|10\.0\.2\.2/.test(url);
}

function metroOrigin() {
  const scriptURL = NativeModules.SourceCode?.scriptURL as string | undefined;
  const fromScript = scriptURL?.match(/^(https?:\/\/[^/]+)/)?.[1];
  if (fromScript && !isLoopback(fromScript)) return fromScript.replace(/\/$/, "");
  const dbg = Constants.expoGoConfig?.debuggerHost || Constants.expoConfig?.hostUri || "";
  const hostPort = dbg.replace(/^https?:\/\//, "").split("/")[0];
  if (hostPort && !isLoopback(hostPort)) return `http://${hostPort}`;
  return null;
}

function envApiUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") || "";
  if (!fromEnv) return "";
  if (isLoopback(fromEnv)) return fromEnv.replace(/:3000$/, ":8081").replace(/:4000$/, ":8081");
  return fromEnv;
}

export function apiBase() {
  const fromEnv = envApiUrl();
  if (Platform.OS === "web") {
    // Same-origin on Vercel (and local Metro). Do not use a laptop LAN IP from mobile/.env.
    if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
    return fromEnv || "http://localhost:8081";
  }
  const origin = metroOrigin();
  if (origin) return origin;
  if (fromEnv) return fromEnv;
  return "http://localhost:8081";
}

export type NavItem = { key: string; label: string; permission: string | null };

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleName: string;
  portal: "OFFICE" | "TEACHER" | "PARENT" | "STUDENT";
  permissions: string[];
};

export type ChildCard = {
  id: string;
  name: string;
  classLabel: string;
  attendancePct: number;
  avgPct: number;
  interests: string[];
};

export type HomePayload =
  | {
      kind: "PARENT";
      school: string;
      kicker: string;
      title: string;
      lede: string;
      children: { id: string; name: string; classLabel: string }[];
      child: ChildCard | null;
    }
  | {
      kind: "STUDENT";
      school: string;
      kicker: string;
      title: string;
      lede: string;
      child: ChildCard | null;
    }
  | {
      kind: "TEACHER";
      school: string;
      kicker: string;
      title: string;
      lede: string;
      classLabel: string;
      classTeacher: boolean;
      markedToday: boolean;
    }
  | {
      kind: "OFFICE";
      school: string;
      kicker: string;
      title: string;
      lede: string;
      name: string;
    };

export type Notice = {
  id: string;
  title: string;
  body: string;
  kind?: string;
  eventKey?: string;
  priority?: string;
  createdAt: string;
  author: string;
  studentId?: string | null;
  classes: { id: string; label: string }[];
};

async function parse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || "Request failed.");
  }
  return data;
}

export function webOrigin() {
  const base = apiBase();
  if (isLoopback(base)) return base.replace(/:8081$/, ":4000");
  return base;
}

export function payHref(shareToken: string) {
  return `${webOrigin()}/pay/${shareToken}`;
}

export async function api<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const url = `${apiBase()}/api/v1${path}`;
  console.log("[anekio]", init?.method || "GET", url);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch {
    throw new Error(`Can't reach ${url}. Same Wi-Fi as the computer, keep npm run api on.`);
  }
  return parse(res) as Promise<T>;
}
