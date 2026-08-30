import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "anekio.token";
const CHILD_KEY = "anekio.child";

export async function getToken() {
  if (Platform.OS === "web") {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(KEY);
}

export async function setToken(token: string) {
  if (Platform.OS === "web") {
    localStorage.setItem(KEY, token);
    return;
  }
  await SecureStore.setItemAsync(KEY, token);
}

export async function clearToken() {
  if (Platform.OS === "web") {
    localStorage.removeItem(KEY);
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}

export async function getChildId() {
  if (Platform.OS === "web") {
    try {
      return localStorage.getItem(CHILD_KEY);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(CHILD_KEY);
}

export async function setChildId(id: string) {
  if (Platform.OS === "web") {
    localStorage.setItem(CHILD_KEY, id);
    return;
  }
  await SecureStore.setItemAsync(CHILD_KEY, id);
}

const NOTICES_SEEN_KEY = "anekio.noticesSeen";

async function readStore(key: string) {
  if (Platform.OS === "web") {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function writeStore(key: string, value: string) {
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function getSeenNoticeIds(userId: string) {
  const raw = await readStore(NOTICES_SEEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { userId?: string; ids?: string[] };
    if (parsed.userId !== userId || !Array.isArray(parsed.ids)) return null;
    return parsed.ids;
  } catch {
    return null;
  }
}

export async function setSeenNoticeIds(userId: string, ids: string[]) {
  await writeStore(NOTICES_SEEN_KEY, JSON.stringify({ userId, ids: ids.slice(0, 200) }));
}
