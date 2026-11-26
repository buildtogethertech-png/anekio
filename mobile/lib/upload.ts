import { Platform } from "react-native";
import { apiBase } from "./api";
import { chooseAttachSource } from "./photo-capture";

export type PickedFile = { uri: string; name: string; type: string };

/** Pick a file. On the phone, where a photo is allowed, the attach sheet first offers Camera / Gallery (/ File). */
export async function pickFile(accept = "*/*", opts: { ask?: boolean } = {}): Promise<PickedFile | null> {
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
  const types = nativeMimeTypes(accept);
  const images = types.some((t) => t.startsWith("image/"));
  if (images && opts.ask !== false) {
    const others = types.some((t) => !t.startsWith("image/"));
    const source = await chooseAttachSource({ files: others });
    if (!source) return null;
    if (source.kind === "photo") return source.file;
    if (source.kind === "photos") return openDocumentPicker(types.filter((t) => t.startsWith("image/")));
  }
  return openDocumentPicker(types);
}

const EXT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Android's picker takes a list of MIME types; one "a,b,c" string matches no file, so every file is greyed out. */
export function nativeMimeTypes(accept: string): string[] {
  const out = new Set<string>();
  for (const raw of String(accept || "").split(",")) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (t.startsWith(".")) {
      const mime = EXT_TYPES[t.slice(1)];
      if (mime) out.add(mime);
    } else if (t.includes("/")) {
      out.add(t);
    }
  }
  return out.size ? [...out] : ["*/*"];
}

async function openDocumentPicker(types: string[]): Promise<PickedFile | null> {
  try {
    const picker = require("expo-document-picker") as {
      getDocumentAsync: (opts: { type?: string | string[]; copyToCacheDirectory?: boolean }) => Promise<{
        canceled?: boolean;
        assets?: { uri: string; name?: string; mimeType?: string }[];
      }>;
    };
    const result = await picker.getDocumentAsync({ type: types.length === 1 ? types[0] : types, copyToCacheDirectory: true });
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
  const uploadThroughApi = async () => {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    if (Platform.OS === "web" && file instanceof File) {
      body.append("file", file);
    } else if (Platform.OS === "web" && "uri" in file) {
      body.append("file", blob, file.name);
    } else {
      body.append("file", { uri: picked.uri, name: picked.name, type: picked.type } as unknown as Blob);
    }
    const apiHeaders = new Headers(headers);
    apiHeaders.delete("Content-Type");
    const res = await fetch(`${apiBase()}/api/files`, { method: "POST", headers: apiHeaders, body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || "Upload failed.");
    return data as { ok: true; path: string; fileName: string };
  };
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
    }).catch(() => null);
    if (!uploaded?.ok) return uploadThroughApi();
    const completed = await fetch(`${apiBase()}/api/files/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ completionToken: prepared.completionToken }),
    });
    const result = await completed.json().catch(() => ({}));
    if (!completed.ok) throw new Error((result as { error?: string }).error || "Could not complete upload.");
    return result as { ok: true; path: string; fileName: string };
  }

  return uploadThroughApi();
}
