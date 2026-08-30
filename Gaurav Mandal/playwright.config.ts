import { randomBytes } from "node:crypto";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.test", quiet: true });

const isCI = Boolean(process.env.CI);
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT || 4100);
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL?.trim() ||
  process.env.BASE_URL?.trim() ||
  "http://127.0.0.1:8082";
const webPort = Number(new URL(baseURL).port || 80);
const startLocalServers =
  process.env.PLAYWRIGHT_SKIP_WEBSERVER !== "1" &&
  ["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname);
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL?.trim() ||
  `file:${path.join(process.cwd(), "test-results", "playwright", "test-e2e.db")}`;
const databasePath = testDatabaseUrl.slice("file:".length).toLowerCase();

if (
  startLocalServers &&
  (!testDatabaseUrl.startsWith("file:") ||
    !databasePath.includes("test") ||
    /(^|[/\\])(dev|demo)\.db(?:$|[?#])/i.test(databasePath))
) {
  throw new Error(
    "Local Playwright runs require TEST_DATABASE_URL to name a dedicated test SQLite file, never dev.db or demo.db."
  );
}

const apiEnvironment = {
  NODE_ENV: "test",
  TEST_SERVER_LISTEN: "1",
  PORT: String(apiPort),
  DATABASE_URL: testDatabaseUrl,
  JWT_SECRET: process.env.TEST_JWT_SECRET?.trim() || randomBytes(32).toString("hex"),
  PUBLIC_URL: `http://127.0.0.1:${apiPort}`,
  UPLOADS_DIR: "test-results/playwright/uploads",
  VERCEL: "",
  CRON_SECRET: "",
  // Never inherit developer payment credentials into an automated UI run.
  RAZORPAY_KEY_ID: "",
  RAZORPAY_KEY_SECRET: "",
  RAZORPAY_WEBHOOK_SECRET: "",
};

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/playwright/artifacts",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{projectName}/{arg}{ext}",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // Anekio's E2E data is a shared seeded SQLite database; shard in CI only
  // after each shard receives its own TEST_DATABASE_URL and fixture accounts.
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 0,
      threshold: 0.2,
    },
  },
  reporter: [
    [isCI ? "dot" : "list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "test-results/playwright/junit.xml" }],
    ["json", { outputFile: "test-results/playwright/results.json" }],
  ],
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    colorScheme: "light",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "phone-chromium",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "phone-webkit",
      use: { ...devices["iPhone 15"] },
    },
  ],
  webServer: startLocalServers
    ? [
        {
          command:
            process.env.PLAYWRIGHT_API_COMMAND ||
            "tsx tests/support/start-e2e-server.ts",
          url: `http://127.0.0.1:${apiPort}/health`,
          timeout: 120_000,
          reuseExistingServer: false,
          stdout: "pipe",
          stderr: "pipe",
          env: apiEnvironment,
        },
        {
          command:
            process.env.PLAYWRIGHT_WEB_COMMAND ||
            `npm --prefix mobile run web -- --port ${webPort}`,
          url: baseURL,
          timeout: 180_000,
          reuseExistingServer: false,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            CI: "1",
            ANEKIO_API_PROXY_PORT: String(apiPort),
            EXPO_PUBLIC_API_URL: baseURL,
          },
        },
      ]
    : undefined,
});
