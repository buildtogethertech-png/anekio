import { expect, test } from "@playwright/test";
import { givenLoggedOutUser } from "./helpers/login";

test("login screen remains visually stable @visual", async ({ page }, testInfo) => {
  await test.step("Given a logged-out user on the login screen", async () => {
    await givenLoggedOutUser(page);
  });

  await test.step("Then the login card matches its approved appearance", async () => {
    await page.getByTestId("login-api-base").evaluate((element) => {
      element.textContent = "API test-environment";
    });
    const loginScreen = page.getByTestId("login-screen");
    const captureOptions = {
      animations: "disabled",
      caret: "hide",
    } as const;

    await expect(loginScreen).toHaveScreenshot("login-screen.png", {
      ...captureOptions,
      maxDiffPixels: 0,
    });

    // Playwright automatically includes expected/actual/diff on failure. These
    // explicit attachments make the approved and current images visible on a pass too.
    await testInfo.attach("expected-login-screen", {
      path: testInfo.snapshotPath("login-screen.png"),
      contentType: "image/png",
    });
    await testInfo.attach("actual-login-screen", {
      body: await loginScreen.screenshot(captureOptions),
      contentType: "image/png",
    });
  });
});
