/**
 * One JSON object per line on stdout/stderr (PM2 writes them to /var/log/anekio/{out,error}.log;
 * Grafana Alloy ships them to Loki). Never pass passwords, tokens or request bodies in fields.
 */
type Level = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const IST_OFFSET_MS = 330 * 60_000;

function minLevel() {
  const configured = String(process.env.LOG_LEVEL || "").toLowerCase() as Level;
  return LEVELS[configured] ?? LEVELS.info;
}

/** 2026-11-05T10:12:03.120+05:30 */
export function istTimestamp(at = new Date()) {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().replace("Z", "+05:30");
}

export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) return { err: error.message, errName: error.name, stack: error.stack };
  return { err: String(error) };
}

export function formatLogLine(level: Level, msg: string, fields: LogFields = {}, at = new Date()) {
  const entry: LogFields = { t: istTimestamp(at), lvl: level, msg };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    if (value instanceof Error) Object.assign(entry, errorFields(value));
    else entry[key] = value;
  }
  return JSON.stringify(entry);
}

function write(level: Level, msg: string, fields?: LogFields) {
  if (LEVELS[level] < minLevel()) return;
  const line = `${formatLogLine(level, msg, fields)}\n`;
  if (level === "error" || level === "warn") process.stderr.write(line);
  else process.stdout.write(line);
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};
