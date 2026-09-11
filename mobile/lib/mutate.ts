import { api } from "./api";

export async function act<T = { ok: true }>(token: string | null, op: string, body: Record<string, unknown> = {}) {
  return api<T>("/act", token, { method: "POST", body: JSON.stringify({ ...body, op }) });
}

export async function saveLateTiming<T = { ok: true; rules?: unknown }>(
  token: string | null,
  payload: Record<string, unknown>
) {
  try {
    return await act<T>(token, "saveSchoolPayrollRules", payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/unknown action/i.test(message)) throw error;
    try {
      return await api<T>("/late-timing", token, { method: "POST", body: JSON.stringify(payload) });
    } catch {
      throw new Error("Late timing could not save. Restart npm run api, then try again.");
    }
  }
}
