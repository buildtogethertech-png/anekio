import { copyFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

let done = false;

export function prepareVercelRuntime() {
  if (done) return;
  done = true;
  if (!process.env.VERCEL) return;
  const currentDatabaseUrl = String(process.env.DATABASE_URL || "");
  if (currentDatabaseUrl && !currentDatabaseUrl.startsWith("file:")) return;

  const tmpDb = "/tmp/anekio.db";
  const bundled = path.join(process.cwd(), "prisma", "demo.db");
  if (!existsSync(tmpDb) && existsSync(bundled)) copyFileSync(bundled, tmpDb);
  process.env.DATABASE_URL = `file:${tmpDb}`;

  if (String(process.env.UPLOADS_DRIVER || "local").toLowerCase() !== "s3") {
    const uploads = "/tmp/anekio-uploads";
    if (!existsSync(uploads)) mkdirSync(uploads, { recursive: true });
    process.env.UPLOADS_DIR = uploads;
  }

}
