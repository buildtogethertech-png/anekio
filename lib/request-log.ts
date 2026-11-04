/** Fields for the one-line-per-API-request log (`msg: "req"`). No query strings, bodies or tokens. */
export type RequestLogInput = {
  method: string;
  path: string;
  status: number;
  ms: number;
  op?: string;
  platformHeader?: string | null;
  buildHeader?: string | null;
  user?: { id: string; orgId?: string | null; role?: string | null; support?: unknown } | null;
};

export function shouldLogRequest(path: string) {
  return path.startsWith("/api/");
}

export function requestPlatform(header?: string | null) {
  const value = String(header || "").trim().toLowerCase();
  return value === "android" || value === "ios" ? value : "web";
}

/** "GET /api/v1/students/ck3x…/fees" → "GET /api/v1/students/:id" — a stable feature key for usage counts. */
export function routeKey(method: string, path: string) {
  const parts = path
    .split("/")
    .slice(0, 5)
    .map((part) => (/^\d+$/.test(part) || (part.length > 8 && /\d/.test(part)) || part.length > 24 ? ":id" : part));
  return `${method} ${parts.join("/")}`;
}

export function requestLogFields(input: RequestLogInput) {
  const build = Math.floor(Number(input.buildHeader) || 0);
  return {
    method: input.method,
    path: input.path,
    op: input.op || undefined,
    status: input.status,
    ms: Math.round(input.ms),
    org: input.user?.orgId || undefined,
    user: input.user?.id,
    role: input.user?.role || undefined,
    support: input.user?.support ? true : undefined,
    platform: requestPlatform(input.platformHeader),
    build: build || undefined,
  };
}
