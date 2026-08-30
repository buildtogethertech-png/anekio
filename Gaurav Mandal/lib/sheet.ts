import { PathTag } from "@prisma/client";

export type SheetRow = Record<string, string>;

export function parseCsv(text: string): SheetRow[] {
  const raw = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = splitCsvLines(raw).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: SheetRow = {};
    headers.forEach((h, i) => {
      if (h) row[h] = (cells[i] || "").trim();
    });
    return row;
  });
}

export function cell(row: SheetRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[normalizeHeader(key)];
    if (value) return value;
  }
  return "";
}

export function parseDob(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function parseClassLabel(raw: string): { name: string; section: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const dashed = s.match(/^(\d+)\s*[-]\s*([A-Za-z])$/);
  if (dashed) return { name: dashed[1], section: dashed[2].toUpperCase() };
  const glued = s.match(/^(\d+)\s*([A-Za-z])$/);
  if (glued) return { name: glued[1], section: glued[2].toUpperCase() };
  return null;
}

export function parsePathTags(raw: string): PathTag[] {
  const alias: Record<string, PathTag> = {
    olympiad: "OLYMPIAD",
    sports: "SPORTS",
    spelling: "SPELLING",
    science: "SCIENCE",
    arts: "ARTS",
  };
  const seen = new Set<PathTag>();
  for (const part of raw.split(/[;,]/)) {
    const tag = alias[part.trim().toLowerCase()];
    if (tag) seen.add(tag);
  }
  return [...seen];
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function splitCsvLines(text: string) {
  const lines: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === "\n" && !quoted) {
      lines.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) lines.push(current);
  return lines;
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if ((ch === "," || ch === "\t") && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}
