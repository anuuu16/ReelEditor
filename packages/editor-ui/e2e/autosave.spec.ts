// A refresh must never throw work away: the edit is snapshotted locally within a second, the
// project is saved to ~/ReelStudioProjects (here: a temp folder) a few seconds later, and whoever
// reopens the project gets the fresher of the two.
import { expect, test } from "@playwright/test";
import { RENDER_URL } from "./env.js";
import { importAndAddClip, openFreshVideoEditor, savedProject, webmSample } from "./helpers.js";

test("an edit survives a refresh made before the server save, and then reaches the server", async ({ page }) => {
  const projectId = await openFreshVideoEditor(page);
  await importAndAddClip(page, webmSample());
  await expect(page.locator(".save-label")).toHaveText("Unsaved changes");

  // Give the local snapshot its second, then refresh well inside the server save's debounce.
  await page.waitForTimeout(1200);
  page.once("dialog", (dialog) => dialog.accept()); // the "unsaved changes" leave-page prompt
  await page.reload();

  await expect(page.locator(".clip-block")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(".media-name")).toHaveText("clip-long-30s.webm");

  // The restored project is then saved for real.
  await expect(page.locator(".save-label")).toHaveText("Saved", { timeout: 20_000 });
  await expect.poll(async () => (await savedProject(RENDER_URL, projectId))?.clips.length).toBe(1);

  // And a second refresh, after that, opens the same thing.
  await page.reload();
  await expect(page.locator(".clip-block")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(".save-label")).toHaveText("Saved", { timeout: 20_000 });
});

test("a refresh after the save landed opens the saved project as before", async ({ page }) => {
  const projectId = await openFreshVideoEditor(page);
  await importAndAddClip(page, webmSample());
  await expect(page.locator(".save-label")).toHaveText("Saved", { timeout: 20_000 });
  expect((await savedProject(RENDER_URL, projectId))?.clips).toHaveLength(1);
  await page.reload();
  await expect(page.locator(".clip-block")).toHaveCount(1, { timeout: 15_000 });
});
