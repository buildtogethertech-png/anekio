import { copyFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

let done = false;

export function prepareVercelRuntime() {
  if (done) return;
  done = true;
  if (!process.env.VERCEL) return;

  const tmpDb = "/tmp/anekio.db";
  const bundled = path.join(process.cwd(), "prisma", "demo.db");
  if (!existsSync(tmpDb) && existsSync(bundled)) copyFileSync(bundled, tmpDb);
  process.env.DATABASE_URL = `file:${tmpDb}`;

  const uploads = "/tmp/anekio-uploads";
  if (!existsSync(uploads)) mkdirSync(uploads, { recursive: true });
  process.env.UPLOADS_DIR = uploads;

  if (!process.env.PUBLIC_URL) {
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    if (host) process.env.PUBLIC_URL = host.startsWith("http") ? host : `https://${host}`;
  }
}
