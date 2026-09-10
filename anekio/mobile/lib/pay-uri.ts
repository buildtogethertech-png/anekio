import { payHref, webOrigin } from "./api";

export function firstPayParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value || "";
}

export function payEmbedUri(token: string, path: string, origin = webOrigin()) {
  const raw = path ? `${origin}${path}` : token ? payHref(token) : "";
  return raw ? `${raw}${raw.includes("?") ? "&" : "?"}embed=1` : "";
}

/** Same-origin path so Expo Metro can proxy /pay to the API. */
export function payEmbedPath(token: string, path: string) {
  const raw = path || (token ? `/pay/${token}` : "");
  return raw ? `${raw}${raw.includes("?") ? "&" : "?"}embed=1` : "";
}
