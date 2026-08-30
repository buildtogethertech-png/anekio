import { api } from "./api";

export async function act<T = { ok: true }>(token: string | null, op: string, body: Record<string, unknown> = {}) {
  return api<T>("/act", token, { method: "POST", body: JSON.stringify({ op, ...body }) });
}
