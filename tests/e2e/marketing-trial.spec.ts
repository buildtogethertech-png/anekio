import { expect, test } from "@playwright/test";

for (const scenario of [
  { fields: ["email"], title: "This email is already registered", message: "the email address" },
  { fields: ["phone"], title: "This phone is already registered", message: "the phone number" },
  { fields: ["email", "phone"], title: "Email and phone are already registered", message: "email and phone details" },
]) {
  test(`duplicate ${scenario.fields.join(" and ")} keeps entered details and offers sign-in`, async ({ page }) => {
    await page.route("**/api/saas/trial", (route) => route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Already registered.", loginUrl: "/login", conflictFields: scenario.fields }),
    }));
    await page.goto("http://localhost:4000/", { waitUntil: "domcontentloaded" });
    await page.locator("#trial-form input[name=schoolName]").fill("River School");
    await page.locator("#trial-form input[name=ownerName]").fill("Asha Owner");
    await page.locator("#trial-form input[name=ownerEmail]").fill("asha@example.com");
    await page.locator("#trial-form input[name=ownerPhone]").fill("9876543210");
    await page.locator("#trial-form input[name=city]").fill("Delhi");
    await page.locator("#trial-form button[type=submit]").click();

    await expect(page.locator("#trial-error")).toBeVisible();
    await expect(page.locator("#trial-error-title")).toHaveText(scenario.title);
    await expect(page.locator("#trial-error-message")).toContainText(scenario.message);
    await expect(page.locator("#trial-error-login")).toHaveAttribute("href", "http://localhost:8081/login");
    await expect(page.locator("#trial-form input[name=ownerEmail]")).toHaveValue("asha@example.com");
    await expect(page.locator("#trial-form input[name=ownerPhone]")).toHaveValue("9876543210");
    await expect(page.getByText("Setting up your workspace…")).toHaveCount(0);
  });
}

test("successful trial signup opens the ready screen", async ({ page }) => {
  await page.route("**/api/saas/trial", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ org: { schoolName: "River School" }, login: "9876543210", password: "temporary-password" }),
  }));
  await page.goto("http://localhost:4000/", { waitUntil: "domcontentloaded" });
  await page.locator("#trial-form input[name=schoolName]").fill("River School");
  await page.locator("#trial-form input[name=ownerName]").fill("Asha Owner");
  await page.locator("#trial-form input[name=ownerEmail]").fill("asha@example.com");
  await page.locator("#trial-form input[name=ownerPhone]").fill("9876543210");
  await page.locator("#trial-form input[name=city]").fill("Delhi");
  await page.locator("#trial-form button[type=submit]").click();

  await expect(page.locator("#trial-ready")).toBeVisible();
  await expect(page.locator("#trial-ready")).toContainText("9876543210");
  await expect(page.locator("#trial-form")).toBeHidden();
});

test("temporary trial failure keeps the form ready to retry", async ({ page }) => {
  await page.route("**/api/saas/trial", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "Please try again shortly." }),
  }));
  await page.goto("http://localhost:4000/", { waitUntil: "domcontentloaded" });
  await page.locator("#trial-form input[name=schoolName]").fill("River School");
  await page.locator("#trial-form input[name=ownerName]").fill("Asha Owner");
  await page.locator("#trial-form input[name=ownerEmail]").fill("asha@example.com");
  await page.locator("#trial-form input[name=ownerPhone]").fill("9876543210");
  await page.locator("#trial-form input[name=city]").fill("Delhi");
  await page.locator("#trial-form button[type=submit]").click();

  await expect(page.locator("#trial-error-message")).toContainText("Your form is still filled in");
  await expect(page.locator("#trial-error-login")).toBeHidden();
  await expect(page.locator("#trial-form input[name=schoolName]")).toHaveValue("River School");
  await expect(page.locator("#trial-form button[type=submit]")).toBeEnabled();
});
