import { randomBytes } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ path: ".env.test", quiet: true });

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || "file:./test-vitest.db";
const databasePath = testDatabaseUrl.slice("file:".length).toLowerCase();

// Anekio uses SQLite. Never let an ordinary test run inherit .env's dev.db.
if (
  !testDatabaseUrl.startsWith("file:") ||
  !databasePath.includes("test") ||
  /(^|[/\\])(dev|demo)\.db(?:$|[?#])/i.test(databasePath)
) {
  throw new Error(
    "TEST_DATABASE_URL must be a dedicated SQLite file URL whose path contains 'test' and is not dev.db or demo.db."
  );
}

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./", import.meta.url).pathname,
    },
  },
  test: {
    name: "server",
    environment: "node",
    globals: false,
    include: [
      "tests/**/*.{test,spec}.ts",
      "lib/**/*.{test,spec}.ts",
      "server/**/*.{test,spec}.ts",
    ],
    exclude: [
      "tests/e2e/**",
      "mobile/**",
      "node_modules/**",
      ".next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/test-results/**",
    ],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl,
      JWT_SECRET: process.env.TEST_JWT_SECRET?.trim() || randomBytes(32).toString("hex"),
      PUBLIC_URL: "http://127.0.0.1:4000",
      VERCEL: "",
      CRON_SECRET: "",
      // External delivery and payment services stay disabled in deterministic tests.
      RAZORPAY_KEY_ID: "",
      RAZORPAY_KEY_SECRET: "",
      RAZORPAY_WEBHOOK_SECRET: "",
    },
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    isolate: true,
    // Integration tests share the Prisma singleton and an isolated SQLite file.
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    testTimeout: 10_000,
    hookTimeout: 30_000,
    reporters: ["default", "html", "junit", "json"],
    outputFile: {
      html: "./test-results/vitest/index.html",
      junit: "./test-results/vitest/junit.xml",
      json: "./test-results/vitest/results.json",
    },
    coverage: {
      provider: "v8",
      enabled: false,
      include: ["lib/**/*.ts", "server/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.{test,spec}.ts",
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "**/test-results/**",
      ],
      reportsDirectory: "./coverage/server",
      reporter: ["text", "html", "lcov", "json-summary", "cobertura"],
      reportOnFailure: true,
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
