import { expect, type Page } from "@playwright/test";
import type { Portal, TestAccount } from "../fixtures/accounts";

const loginPath = /\/api\/v1\/login(?:\?|$)/;

export async function givenLoggedOutUser(page: Page) {
  await page.goto("/login");
  await page.evaluate(() => {
    localStorage.removeItem("anekio.token");
    localStorage.removeItem("anekio.child");
  });
  await page.reload();
  await expect(page.getByTestId("login-screen")).toBeVisible();
}

export async function whenUserSignsIn(page: Page, account: TestAccount) {
  await page.getByTestId("login-identity").fill(account.login);
  await page.getByTestId("login-password").fill(account.password);

  // Register the response waiter before the click so a fast local response cannot race the test.
  const loginResponse = page.waitForResponse(
    (response) => response.request().method() === "POST" && loginPath.test(new URL(response.url()).pathname)
  );
  await page.getByTestId("login-submit").click();

  const response = await loginResponse;
  expect(response.ok(), `login returned ${response.status()}`).toBeTruthy();
}

export async function thenPortalHomeIsVisible(page: Page, portal: Portal) {
  await expect(page).toHaveURL(/\/(?:index)?$/);
  await expect(page.getByTestId(`home-${portal.toLowerCase()}`)).toBeVisible();
}
