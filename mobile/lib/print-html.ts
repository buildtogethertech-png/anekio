import { Linking, Platform } from "react-native";
import { apiBase } from "./api";

function errorFromBody(text: string, fallback: string) {
  try {
    const data = JSON.parse(text) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

export async function openHtmlDocument(html: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const frame = window.open("", "_blank");
    if (!frame) throw new Error("Allow pop-ups to open the PDF.");
    frame.document.write(html);
    frame.document.close();
    frame.focus();
    frame.print();
    return;
  }
  await Linking.openURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

export async function openAuthedFile(url: string, token: string | null) {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(errorFromBody(text, "Could not open this file."));
  }
  const blob = await res.blob();
  if (Platform.OS === "web" && typeof window !== "undefined" && typeof URL !== "undefined") {
    const href = URL.createObjectURL(blob);
    const opened = window.open(href, "_blank");
    if (!opened) throw new Error("Allow pop-ups to open the PDF.");
    return;
  }
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const b64 = globalThis.btoa(binary);
  const type = blob.type || "application/pdf";
  await Linking.openURL(`data:${type};base64,${b64}`);
}

export async function downloadAuthedFile(url: string, token: string | null, fileName: string) {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(errorFromBody(text, "Could not download this file."));
  }
  const blob = await res.blob();
  if (Platform.OS === "web" && typeof document !== "undefined" && typeof URL !== "undefined") {
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    return;
  }
  await openAuthedFile(url, token);
}

export async function openMarksheetPdf(
  token: string | null,
  query: { seriesId?: string; examId?: string; studentId?: string }
) {
  if (!token) throw new Error("Sign in again.");
  const qs = new URLSearchParams();
  if (query.seriesId) qs.set("seriesId", query.seriesId);
  if (query.examId) qs.set("examId", query.examId);
  if (query.studentId) qs.set("studentId", query.studentId);
  const res = await fetch(`${apiBase()}/api/v1/marksheet?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const html = await res.text();
  if (!res.ok) throw new Error(errorFromBody(html, "Marksheet unavailable."));
  await openHtmlDocument(html);
}
