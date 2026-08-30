import type { Locator, Page, TestInfo } from "@playwright/test";
import type { TestAccount } from "../fixtures/accounts";

const recordPath = /\/api\/v1\/record(?:\?|$)/;
const noticesPath = /\/api\/v1\/notices(?:\?|$)/;
const fixedBrowserTime = new Date("2026-08-24T06:30:00.000Z");

type LoginPayload = { token?: unknown };

export async function givenAuthenticatedPortal(page: Page, account: TestAccount) {
  await page.clock.setFixedTime(fixedBrowserTime);

  const response = await page.request.post("/api/v1/login", {
    data: { login: account.login, password: account.password },
  });
  if (!response.ok()) {
    throw new Error(`Visual-test login failed with ${response.status()}: ${await response.text()}`);
  }

  const payload = (await response.json()) as LoginPayload;
  if (typeof payload.token !== "string" || !payload.token) {
    throw new Error("Visual-test login did not return a token.");
  }

  await page.addInitScript((token: string) => {
    localStorage.setItem("anekio.token", token);
    localStorage.removeItem("anekio.child");
    localStorage.removeItem("anekio.noticesSeen");
  }, payload.token);
}

export async function openStablePortalScreen(page: Page, path: string, screenKey: string) {
  const recordResponse = page.waitForResponse(
    (response) => response.request().method() === "GET" && recordPath.test(new URL(response.url()).pathname)
  );
  const noticesResponse = page.waitForResponse(
    (response) => response.request().method() === "GET" && noticesPath.test(new URL(response.url()).pathname)
  );

  await page.goto(path, { waitUntil: "domcontentloaded" });
  const [record, notices] = await Promise.all([recordResponse, noticesResponse]);
  if (!record.ok()) throw new Error(`Record request failed with ${record.status()}.`);
  if (!notices.ok()) throw new Error(`Notices request failed with ${notices.status()}.`);

  const screen = page.getByTestId(`portal-screen-${screenKey}`);
  await screen.waitFor({ state: "visible" });
  return screen;
}

export async function attachActualVisual(
  actual: Buffer,
  testInfo: TestInfo,
  attachmentLabel: string
) {
  await testInfo.attach(`actual-${attachmentLabel}`, {
    body: actual,
    contentType: "image/png",
  });
}

export async function attachExpectedVisual(testInfo: TestInfo, snapshotName: string, attachmentLabel: string) {
  await testInfo.attach(`expected-${attachmentLabel}`, {
    path: testInfo.snapshotPath(snapshotName),
    contentType: "image/png",
  });
}

export async function waitForVisualContent(screen: Locator, readyText?: string) {
  await screen.getByText("Loading…", { exact: true }).waitFor({ state: "detached" });
  if (readyText) await screen.getByText(readyText, { exact: true }).waitFor({ state: "visible" });
}
