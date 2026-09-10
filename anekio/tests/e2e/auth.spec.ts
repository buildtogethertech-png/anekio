import { test } from "@playwright/test";
import { accountFor, portals } from "./fixtures/accounts";
import { givenLoggedOutUser, thenPortalHomeIsVisible, whenUserSignsIn } from "./helpers/login";

test.describe("portal login", () => {
  for (const portal of portals) {
    test(`${portal.toLowerCase()} user reaches the correct home @p0`, async ({ page }) => {
      await test.step("Given a logged-out Anekio user", async () => {
        await givenLoggedOutUser(page);
      });

      await test.step(`When the ${portal.toLowerCase()} user signs in`, async () => {
        await whenUserSignsIn(page, accountFor(portal));
      });

      await test.step(`Then the ${portal.toLowerCase()} home is shown`, async () => {
        await thenPortalHomeIsVisible(page, portal);
      });
    });
  }
});
