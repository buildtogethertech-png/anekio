import { describe, expect, it } from "vitest";
import { errorFields, formatLogLine, istTimestamp } from "../../lib/logger";
import { requestLogFields, requestPlatform, routeKey, shouldLogRequest } from "../../lib/request-log";
import { istDay, mergeOps, parseOps, pendingUsage, recordUsage, summarizeUsage, type UsageRow } from "../../lib/usage";

describe("logger", () => {
  it("writes one JSON object with an IST timestamp and drops empty fields", () => {
    const line = formatLogLine("info", "req", { path: "/api/v1/act", op: undefined, org: "", status: 200 }, new Date("2026-11-04T20:00:00Z"));
    expect(JSON.parse(line)).toEqual({ t: "2026-11-05T01:30:00.000+05:30", lvl: "info", msg: "req", path: "/api/v1/act", status: 200 });
  });

  it("expands errors into message, name and stack", () => {
    const parsed = JSON.parse(formatLogLine("error", "boom", { cause: new TypeError("bad input") }));
    expect(parsed).toMatchObject({ lvl: "error", err: "bad input", errName: "TypeError" });
    expect(parsed.stack).toContain("TypeError");
    expect(errorFields("plain")).toEqual({ err: "plain" });
  });

  it("formats IST timestamps", () => {
    expect(istTimestamp(new Date("2026-01-01T18:30:00Z"))).toBe("2026-01-02T00:00:00.000+05:30");
  });
});

describe("request log", () => {
  it("logs only API paths", () => {
    expect(shouldLogRequest("/api/v1/act")).toBe(true);
    expect(shouldLogRequest("/health")).toBe(false);
    expect(shouldLogRequest("/_expo/static/js/web/entry.js")).toBe(false);
  });

  it("maps the platform header and treats anything else as web", () => {
    expect(requestPlatform("android")).toBe("android");
    expect(requestPlatform("IOS")).toBe("ios");
    expect(requestPlatform(undefined)).toBe("web");
    expect(requestPlatform("windows")).toBe("web");
  });

  it("keeps ids out of feature keys", () => {
    expect(routeKey("GET", "/api/v1/students/ckz1a2b3c4d5e6f7g8h9/fees")).toBe("GET /api/v1/students/:id");
    expect(routeKey("GET", "/api/files/public/schools/primary/branding/logos/3ec1d497-21fa.png")).toBe("GET /api/files/public/schools");
    expect(routeKey("GET", "/api/v1/home")).toBe("GET /api/v1/home");
  });

  it("builds request fields without bodies or secrets", () => {
    const fields = requestLogFields({
      method: "POST",
      path: "/api/v1/act",
      status: 200,
      ms: 83.6,
      op: "markAttendance",
      platformHeader: "android",
      buildHeader: "42",
      user: { id: "u1", orgId: "o1", role: "teacher" },
    });
    expect(fields).toEqual({ method: "POST", path: "/api/v1/act", op: "markAttendance", status: 200, ms: 84, org: "o1", user: "u1", role: "teacher", support: undefined, platform: "android", build: 42 });
  });
});

describe("usage tracking", () => {
  it("uses the IST calendar day", () => {
    expect(istDay(new Date("2026-11-04T18:29:00Z"))).toBe("2026-11-04");
    expect(istDay(new Date("2026-11-04T18:31:00Z"))).toBe("2026-11-05");
  });

  it("merges op counts and caps new keys", () => {
    expect(mergeOps({ a: 1 }, { a: 2, b: 1 })).toEqual({ a: 3, b: 1 });
    expect(mergeOps({ a: 1 }, { b: 1 }, 1)).toEqual({ a: 1 });
    expect(parseOps('{"a":2,"bad":"x"}')).toEqual({ a: 2 });
    expect(parseOps("not json")).toEqual({});
  });

  it("counts requests per user, day and platform in memory and skips support logins", () => {
    const at = new Date("2026-03-10T05:00:00Z");
    const before = pendingUsage().length;
    recordUsage({ user: { id: "usage-test-user", orgId: "o1", role: "teacher" }, platform: "web", op: "markAttendance", at });
    recordUsage({ user: { id: "usage-test-user", orgId: "o1", role: "teacher" }, platform: "web", op: "markAttendance", at });
    recordUsage({ user: { id: "usage-test-user", orgId: "o1", role: "teacher", support: { sessionId: "s" } }, platform: "web", op: "x", at });
    const rows = pendingUsage().filter((r) => r.userId === "usage-test-user");
    expect(pendingUsage().length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ day: "2026-03-10", requests: 2, ops: { markAttendance: 2 } });
  });

  it("summarises active users and silent schools", () => {
    const now = new Date("2026-11-05T06:00:00Z"); // 11:30 IST, day 2026-11-05
    const row = (day: string, userId: string, orgId: string, extra: Partial<UsageRow> = {}): UsageRow => ({
      day,
      orgId,
      userId,
      role: "teacher",
      platform: "web",
      requests: 5,
      opsJson: '{"markAttendance":3}',
      lastSeenAt: new Date(`${day}T05:00:00Z`),
      ...extra,
    });
    const rows = [
      row("2026-11-05", "u1", "a"),
      row("2026-11-05", "u2", "a", { role: "parent", platform: "android" }),
      row("2026-11-03", "u1", "a"),
      row("2026-10-20", "u3", "b"),
    ];
    const summary = summarizeUsage(rows, [
      { id: "a", schoolName: "Alpha" },
      { id: "b", schoolName: "Beta" },
      { id: "c", schoolName: "Gamma" },
    ], now);
    expect(summary).toMatchObject({ activeSchoolsToday: 1, activeSchoolsWeek: 1, usersToday: 2, usersWeek: 2, usersMonth: 3, requestsToday: 10 });
    expect(summary.daily).toHaveLength(14);
    expect(summary.daily.at(-1)).toEqual({ day: "2026-11-05", users: 2, schools: 1 });
    expect(summary.topOps[0]).toEqual({ op: "markAttendance", count: 9 });
    const [alpha, beta, gamma] = summary.schools;
    expect(alpha).toMatchObject({ name: "Alpha", today: 2, week: 2, month: 2, roles: { teacher: 1, parent: 1 }, platforms: { web: 1, android: 1 } });
    expect(beta).toMatchObject({ name: "Beta", week: 0, month: 1 });
    expect(gamma).toMatchObject({ name: "Gamma", month: 0, lastSeenAt: null });
  });
});
