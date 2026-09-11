import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prismaBin = process.platform === "win32" ? "prisma.cmd" : "prisma";
const tsxBin = process.platform === "win32" ? "tsx.cmd" : "tsx";
const databaseUrl = String(process.env.DATABASE_URL || "");
const usesPostgres = /^postgres(?:ql)?:\/\//i.test(databaseUrl);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function postgresSchemaPath() {
  const sourcePath = path.join(root, "prisma", "schema.prisma");
  const outDir = path.join(root, ".vercel-prisma");
  const outPath = path.join(outDir, "schema.prisma");
  const source = readFileSync(sourcePath, "utf8");
  const rewritten = source.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
  if (rewritten === source) throw new Error("Could not rewrite Prisma datasource provider for Postgres.");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, rewritten, "utf8");
  return outPath;
}

if (usesPostgres) {
  const schemaPath = postgresSchemaPath();
  run(prismaBin, ["generate", "--schema", schemaPath]);
  if (process.env.ANEKIO_DB_PUSH_ON_BUILD === "1") run(prismaBin, ["db", "push", "--schema", schemaPath]);
  if (process.env.ANEKIO_SEED_ON_BUILD === "1") run(tsxBin, ["prisma/seed.ts"]);
} else {
  run(prismaBin, ["generate"]);
  run(prismaBin, ["db", "push"]);
  if (process.env.ANEKIO_SKIP_SEED_ON_BUILD !== "1") run(tsxBin, ["prisma/seed.ts"]);
  const devDb = path.join(root, "prisma", "dev.db");
  if (existsSync(devDb)) copyFileSync(devDb, path.join(root, "prisma", "demo.db"));
}
