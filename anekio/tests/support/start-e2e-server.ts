import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const NativeDate = Date;
const fixedTime = NativeDate.parse(
  process.env.PLAYWRIGHT_FIXED_TIME || "2026-08-24T06:30:00.000Z"
);

class FixedDate extends NativeDate {
  constructor(...args: ConstructorParameters<DateConstructor>) {
    super();
    return Reflect.construct(NativeDate, args.length ? args : [fixedTime]);
  }

  static now() {
    return fixedTime;
  }

  static [Symbol.hasInstance](value: unknown) {
    return value instanceof NativeDate;
  }
}

// The visual fixture contains calendar-sensitive desks, attendance, and fee
// summaries. Freeze only the isolated E2E server so approved images do not
// change merely because the test is run on a different day.
globalThis.Date = FixedDate as unknown as DateConstructor;

const requestedUrl = process.env.DATABASE_URL || "";

if (!requestedUrl.startsWith("file:")) {
  throw new Error("Playwright DATABASE_URL must be a file: SQLite URL.");
}

const requestedPath = requestedUrl.slice("file:".length);
const targetDatabase = isAbsolute(requestedPath)
  ? resolve(requestedPath)
  : resolve(process.cwd(), requestedPath);
const lowered = targetDatabase.toLowerCase();
const sourceDatabase = resolve(process.cwd(), "prisma", "dev.db");

if (
  !lowered.includes("test") ||
  /[/\\](?:dev|demo)\.db$/i.test(targetDatabase)
) {
  throw new Error(`Refusing unsafe Playwright database path: ${targetDatabase}`);
}

mkdirSync(dirname(targetDatabase), { recursive: true });
rmSync(targetDatabase, { force: true });
rmSync(`${targetDatabase}-journal`, { force: true });
if (!existsSync(sourceDatabase)) {
  throw new Error("prisma/dev.db is required as a read-only schema template. Run npm run db:seed first.");
}

process.env.DATABASE_URL = `file:${targetDatabase}`;
process.env.NODE_ENV = "test";
process.env.TEST_SERVER_LISTEN = "1";

async function main() {
  const { copyEmptyDatabase } = await import("./test-database");
  const { seedPortalFixture } = await import("./factories");
  copyEmptyDatabase(sourceDatabase, targetDatabase);

  const { prisma } = await import("../../lib/prisma");
  await seedPortalFixture(prisma);
  await import("../../server/index");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
