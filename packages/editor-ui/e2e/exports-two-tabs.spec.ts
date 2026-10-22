// The export queue is the render service's, not any one tab's: a second tab — the same project in
// another editor, or the Dashboard's Exports page — sees the same jobs live, can cancel what the
// first tab started, retry it, and clear everything out when it's done.
import { expect, test, type Page } from "@playwright/test";
import { RENDER_URL } from "./env.js";
import { clearAllExports, importAndAddClip, openFreshVideoEditor, webmSample } from "./helpers.js";

function rows(page: Page) {
  return page.locator(".export-job");
}

async function statuses(page: Page): Promise<string[]> {
  return page.locator(".export-job-status").allInnerTexts();
}

test("tab B cancels, retries and clears what tab A exported", async ({ context, page: tabA }) => {
  test.setTimeout(420_000);
  await clearAllExports(RENDER_URL);
  const projectId = await openFreshVideoEditor(tabA);
  await importAndAddClip(tabA, webmSample());
  await expect(tabA.locator(".save-label")).toHaveText("Saved", { timeout: 20_000 });

  // Tab A: three outputs, rendered one after another.
  await tabA.getByRole("button", { name: "Export" }).click();
  await tabA.getByRole("button", { name: "+ Add another output" }).click();
  await tabA.getByRole("button", { name: "+ Add another output" }).click();
  for (let i = 0; i < 3; i++) await tabA.getByLabel("Quality").nth(i).selectOption("720p");
  await tabA.getByLabel("Format").nth(0).selectOption("mp4");
  await tabA.getByLabel("Format").nth(1).selectOption("gif");
  await tabA.getByLabel("Format").nth(2).selectOption("mov");
  await tabA.getByRole("button", { name: "Export 3 files" }).click();
  await expect(rows(tabA).nth(0).locator(".export-job-status")).toHaveText(/Rendering… [1-9]\d*%/, { timeout: 60_000 });

  // Tab B: the same project in a second editor tab sees the same queue…
  const tabB = await context.newPage();
  await tabB.goto(`/editor/${projectId}`);
  await expect(tabB.locator(".clip-block")).toHaveCount(1, { timeout: 15_000 });
  await expect(tabB.locator(".export-button")).toHaveText(/^Exporting 3 · \d+%$/, { timeout: 15_000 });
  await tabB.locator(".export-button").click();
  await expect(rows(tabB)).toHaveCount(3);
  expect((await statuses(tabB))[0]).toMatch(/^Rendering…/);

  // …and cancels the one tab A is rendering. Both tabs see it; the next output starts.
  await rows(tabB).nth(0).getByRole("button", { name: "Cancel" }).click();
  await expect(rows(tabB).filter({ hasText: "Cancelled" })).toHaveCount(1);
  await expect(rows(tabA).filter({ hasText: "Cancelled" })).toHaveCount(1, { timeout: 10_000 });
  // What's rendering is always on top; the cancelled one has dropped to the history below the line.
  await expect(rows(tabA).nth(0).locator(".export-job-status")).toHaveText(/Rendering…/, { timeout: 15_000 });
  await expect(rows(tabB).nth(0).locator(".export-job-status")).toHaveText(/Rendering…/, { timeout: 15_000 });
  await expect(rows(tabA).nth(2).locator(".export-job-status")).toHaveText("Cancelled");

  // Tab B moves to the Dashboard's Exports page: every export, with its details, after a reload too.
  await tabB.goto("/exports");
  await expect(rows(tabB)).toHaveCount(3, { timeout: 15_000 });
  await tabB.reload();
  await expect(rows(tabB)).toHaveCount(3, { timeout: 15_000 });
  const cancelledRow = rows(tabB).filter({ hasText: "Cancelled" });
  await expect(cancelledRow).toHaveCount(1);
  await expect(cancelledRow.locator(".export-job-name")).toContainText("Untitled reel · Untitled reel - 720x1280.mp4");
  await expect(cancelledRow.locator(".export-job-details")).toContainText("720×1280 MP4 · 30s reel · started");
  await expect(
    rows(tabB)
      .filter({ hasText: /Rendering…/ })
      .locator(".export-progress-fill"),
  ).toHaveCount(1);

  // Retry the cancelled one from tab B: a fresh job with the same settings, queued behind the rest.
  await cancelledRow.getByRole("button", { name: "Retry" }).click();
  await expect(rows(tabB).filter({ hasText: "Cancelled" })).toHaveCount(0);
  await expect(rows(tabB)).toHaveCount(3);
  await expect(rows(tabB).filter({ hasText: "Untitled reel - 720x1280.mp4" }).locator(".export-job-status")).toHaveText(
    /Queued|Rendering…/,
  );
  await expect(rows(tabA).filter({ hasText: "Cancelled" })).toHaveCount(0, { timeout: 10_000 });
  await expect(rows(tabA)).toHaveCount(3);

  // Everything finishes, with sizes, in both tabs.
  await expect(rows(tabB).filter({ hasText: /^(?!.*Done ·)/ })).toHaveCount(0, { timeout: 300_000 });
  for (const status of await statuses(tabB)) expect(status).toMatch(/^Done · \d+(\.\d+)? [KM]B$/);
  for (const status of await statuses(tabA)) expect(status).toMatch(/^Done · /);
  await expect(rows(tabB).filter({ hasText: "rendered in" })).toHaveCount(3);
  await expect(tabB.getByText(/3 exports · .* of finished files on disk/)).toBeVisible();

  // Clear all completed from tab B: gone from the service, so gone from tab A as well.
  tabB.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Remove 3 completed exports and delete");
    void dialog.accept();
  });
  await tabB.getByRole("button", { name: "Clear all completed (3)" }).click();
  await expect(tabB.getByText(/Nothing has been exported yet/)).toBeVisible();
  await expect(rows(tabA)).toHaveCount(0, { timeout: 10_000 });
});
