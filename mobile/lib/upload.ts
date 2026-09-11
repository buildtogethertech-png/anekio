import { Platform } from "react-native";
import { apiBase } from "./api";

export type PickedFile = { uri: string; name: string; type: string };

export async function pickFile(accept = "*/*"): Promise<PickedFile | null> {
  if (Platform.OS === "web") {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        resolve({ uri: URL.createObjectURL(file), name: file.name, type: file.type || "application/octet-stream" });
        (input as unknown as { _file?: File })._file = file;
      };
      input.click();
    });
  }
  try {
    const picker = require("expo-document-picker") as {
      getDocumentAsync: (opts: { type?: string; copyToCacheDirectory?: boolean }) => Promise<{
        canceled?: boolean;
        assets?: { uri: string; name?: string; mimeType?: string }[];
      }>;
    };
    const result = await picker.getDocumentAsync({ type: accept, copyToCacheDirectory: true });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return null;
    return { uri: asset.uri, name: asset.name || "file", type: asset.mimeType || "application/octet-stream" };
  } catch {
    throw new Error("File picker is not available on this device yet.");
  }
}

export async function uploadFile(
  token: string | null,
  file: PickedFile | File,
  fields: Record<string, string>
) {
  const picked = file as PickedFile;
  const blob = Platform.OS === "web" && file instanceof File
    ? file
    : await fetch(picked.uri).then((response) => response.blob());
  const fileName = Platform.OS === "web" && file instanceof File ? file.name : picked.name;
  const fileType = (Platform.OS === "web" && file instanceof File ? file.type : picked.type) || blob.type || "application/octet-stream";
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const prepare = await fetch(`${apiBase()}/api/files/presign`, {
    method: "POST",
    headers,
    body: JSON.stringify({ fileName, fileType, fileSize: blob.size, fields }),
  });
  const prepared = await prepare.json().catch(() => ({})) as {
    direct?: boolean;
    uploadUrl?: string;
    completionToken?: string;
    headers?: Record<string, string>;
    error?: string;
  };
  if (!prepare.ok) throw new Error(prepared.error || "Could not prepare upload.");
  if (prepared.direct) {
    const uploaded = await fetch(String(prepared.uploadUrl || ""), {
      method: "PUT",
      headers: prepared.headers,
      body: blob,
    });
    if (!uploaded.ok) throw new Error("File could not be sent to storage.");
    const completed = await fetch(`${apiBase()}/api/files/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ completionToken: prepared.completionToken }),
    });
    const result = await completed.json().catch(() => ({}));
    if (!completed.ok) throw new Error((result as { error?: string }).error || "Could not complete upload.");
    return result as { ok: true; path: string; fileName: string };
  }

  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  if (Platform.OS === "web" && file instanceof File) {
    body.append("file", file);
  } else if (Platform.OS === "web" && "uri" in file) {
    body.append("file", blob, file.name);
  } else {
    body.append("file", { uri: picked.uri, name: picked.name, type: picked.type } as unknown as Blob);
  }
  headers.delete("Content-Type");
  const url = `${apiBase()}/api/files`;
  const res = await fetch(url, { method: "POST", headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "Upload failed.");
  return data as { ok: true; path: string; fileName: string };
}
