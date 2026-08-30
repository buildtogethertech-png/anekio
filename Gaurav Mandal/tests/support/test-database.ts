import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type TestDatabase = {
  databasePath: string;
  databaseUrl: string;
  directory: string;
  cleanup: () => void;
};

/** Copy a SQLite schema template, then remove every row from the copy. */
export function copyEmptyDatabase(sourcePath: string, targetPath: string) {
  if (resolve(sourcePath) === resolve(targetPath)) {
    throw new Error("Refusing to clear the source SQLite database");
  }

  copyFileSync(sourcePath, targetPath);
  const tableOutput = execFileSync(
    "/usr/bin/sqlite3",
    [targetPath, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"],
    { encoding: "utf8" }
  );
  const tables = tableOutput.split("\n").map((name) => name.trim()).filter(Boolean);
  const emptySql = [
    "PRAGMA foreign_keys=OFF;",
    ...tables.map((name) => `DELETE FROM \"${name.replaceAll('"', '""')}\";`),
    "PRAGMA foreign_keys=ON;",
    "VACUUM;",
  ].join("\n");
  execFileSync("/usr/bin/sqlite3", [targetPath, emptySql], { stdio: "pipe" });
}

/**
 * Creates an empty, schema-compatible SQLite database outside the repository.
 *
 * DATABASE_URL is set before application modules are imported so the cached
 * Prisma singleton can never connect to prisma/dev.db during this test run.
 * The development database is copied only as a schema template; every table in
 * the copy is cleared before Prisma sees it, then factories add deterministic
 * rows. The source file is never opened for writes.
 */
export function createTestDatabase(): TestDatabase {
  const directory = mkdtempSync(join(tmpdir(), "anekio-vitest-"));
  const databasePath = join(directory, "test.db");
  const databaseUrl = `file:${databasePath}`;
  const developmentDatabasePath = resolve(process.cwd(), "prisma", "dev.db");

  if (resolve(databasePath) === developmentDatabasePath) {
    throw new Error("Refusing to use prisma/dev.db for tests");
  }
  if (!existsSync(developmentDatabasePath)) {
    throw new Error("prisma/dev.db is required as the read-only SQLite schema template");
  }

  copyEmptyDatabase(developmentDatabasePath, databasePath);

  process.env.TEST_DATABASE_URL = databaseUrl;
  process.env.DATABASE_URL = databaseUrl;

  return {
    databasePath,
    databaseUrl,
    directory,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
