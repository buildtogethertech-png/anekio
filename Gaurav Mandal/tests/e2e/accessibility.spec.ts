import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { givenLoggedOutUser } from "./helpers/login";

test("login screen has no automatically detectable accessibility violations @p0 @a11y", async ({ page }) => {
  await givenLoggedOutUser(page);

  const results = await new AxeBuilder({ page })
    .include('[data-testid="login-screen"]')
    .analyze();

  expect(results.violations).toEqual([]);
});
