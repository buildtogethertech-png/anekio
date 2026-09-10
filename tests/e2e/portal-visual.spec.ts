import { expect, test } from "@playwright/test";
import { accountFor } from "./fixtures/accounts";
import { portalVisualMatrix } from "./fixtures/visual-screens";
import {
  attachActualVisual,
  attachExpectedVisual,
  givenAuthenticatedPortal,
  openStablePortalScreen,
  waitForVisualContent,
} from "./helpers/visual";

// The visual assertion already preserves current/expected/diff images. Video
// encoding every one of the 132 cases adds substantial browser pressure while
// providing no extra evidence for a pixel mismatch.
test.use({ video: "off" });

test.describe("authenticated portal visuals", () => {
  for (const group of portalVisualMatrix) {
    for (const target of group.screens) {
      const portal = group.portal.toLowerCase();
      const snapshotName = `${portal}-${target.key}.png`;

      test(`${portal} ${target.key} screen remains visually stable @${target.priority} @visual`, async ({ page }, testInfo) => {
        await test.step(`Given an authenticated ${portal} session`, async () => {
          await givenAuthenticatedPortal(page, accountFor(group.portal));
        });

        const screen = await test.step(`When the user opens ${target.path}`, async () => {
          return openStablePortalScreen(page, target.path, target.key);
        });

        await test.step("Then the complete viewport matches its approved appearance", async () => {
          await waitForVisualContent(screen, target.readyText);
          await expect(screen).not.toContainText("No access");
          const actual = await page.screenshot({ animations: "disabled", caret: "hide" });
          await attachActualVisual(actual, testInfo, `${portal}-${target.key}`);
          await expect(actual).toMatchSnapshot(snapshotName, {
            maxDiffPixels: 0,
            threshold: 0.2,
          });
          await attachExpectedVisual(testInfo, snapshotName, `${portal}-${target.key}`);
        });
      });
    }
  }
});
