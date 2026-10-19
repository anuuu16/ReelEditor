// One project exported as several formats in one go, through the real editor and render service:
// the outputs render strictly one after another in the order asked for, a waiting output can be
// cancelled, a rendering one can be cancelled (and its half-written file is deleted), a reload in
// the middle changes nothing, and every finished file downloads under its own name.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Download, type Page } from "@playwright/test";
import { E2E_EXPORTS_ROOT, RENDER_URL } from "./env.js";
import { clearAllExports, importAndAddClip, openFreshVideoEditor, webmSample } from "./helpers.js";

interface JobSummary {
  id: string;
  batchId: string;
  status: string;
  downloadName: string;
}

async function listJobs(projectId: string): Promise<JobSummary[]> {
  return (await (await fetch(`${RENDER_URL}/render?projectId=${projectId}`)).json()) as JobSummary[];
}

function jobDir(job: JobSummary): string {
  return path.join(E2E_EXPORTS_ROOT, job.batchId, job.id);
}

function containerOf(file: string): string {
  const out = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=format_name", "-of", "json", file], {
    encoding: "utf8",
  }).stdout;
  return (JSON.parse(out) as { format: { format_name: string } }).format.format_name;
}

function rows(page: Page) {
  return page.locator(".export-job");
}

async function statuses(page: Page): Promise<string[]> {
  return page.locator(".export-job-status").allInnerTexts();
}

async function saveDownload(download: Download): Promise<string> {
  const file = path.join(E2E_EXPORTS_ROOT, "..", "downloads", download.suggestedFilename());
  await download.saveAs(file);
  return file;
}

test("exports one project as MP4, WebM, GIF and MOV, one at a time, with cancel/reload along the way", async ({ page }) => {
  test.setTimeout(420_000);
  await clearAllExports(RENDER_URL);
  const projectId = await openFreshVideoEditor(page);
  await importAndAddClip(page, webmSample());

  await page.getByRole("button", { name: "Export" }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "+ Add another output" }).click();
  const platform = page.getByLabel("Platform");
  const quality = page.getByLabel("Quality");
  const format = page.getByLabel("Format");
  await expect(quality).toHaveCount(5);
  await platform.nth(0).selectOption("instagram-reel");
  for (let i = 0; i < 4; i++) await quality.nth(i).selectOption("720p");
  await format.nth(0).selectOption("mp4");
  await format.nth(1).selectOption("webm");
  await format.nth(2).selectOption("gif");
  await format.nth(3).selectOption("mov");
  await quality.nth(4).selectOption("1080p"); // the one we'll cancel while it's waiting
  await format.nth(4).selectOption("mp4");

  const targetNames = await page.locator(".export-target-name").allInnerTexts();
  expect(targetNames.map((n) => n.split(" · ")[1])).toEqual([
    "Untitled reel - Instagram Reel 720x1280.mp4",
    "Untitled reel - 720x1280.webm",
    "Untitled reel - 720x1280.gif",
    "Untitled reel - 720x1280.mov",
    "Untitled reel - 1080x1920.mp4",
  ]);

  // The project was saved (autosave) before the export, so the export doesn't carry the media
  // again — it refers to the saved copy, and the request is a few KB instead of the whole clip.
  await expect(page.locator(".save-label")).toHaveText("Saved", { timeout: 20_000 });
  const [renderRequest] = await Promise.all([
    page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/render")),
    page.getByRole("button", { name: "Export 5 files" }).click(),
  ]);
  expect(renderRequest.postDataBuffer()!.byteLength).toBeLessThan(64 * 1024);
  expect(renderRequest.postData()).toContain('name="mediaRefs"');
  await expect(rows(page)).toHaveCount(5);
  await expect(rows(page).nth(0).locator(".export-job-status")).toHaveText(/Rendering…/, { timeout: 30_000 });

  // Strictly one at a time, in the order asked for: what's rendering on top, then the line.
  expect(await statuses(page)).toEqual([
    expect.stringMatching(/^Rendering… \d+%$/),
    "Queued · #1 in line",
    "Queued · #2 in line",
    "Queued · #3 in line",
    "Queued · #4 in line",
  ]);
  const names = () => page.locator(".export-job-name").allInnerTexts();
  expect((await names()).map((n) => n.split(" - ")[1])).toEqual([
    "Instagram Reel 720x1280.mp4",
    "720x1280.webm",
    "720x1280.gif",
    "720x1280.mov",
    "1080x1920.mp4",
  ]);

  // The MOV is needed first: move it to the front of the line. The list follows the new order.
  await rows(page).nth(3).getByRole("button", { name: "⇈ First" }).click();
  await expect(rows(page).nth(1).locator(".export-job-name")).toContainText(".mov");
  expect(await statuses(page)).toEqual([
    expect.stringMatching(/^Rendering…/),
    "Queued · #1 in line",
    "Queued · #2 in line",
    "Queued · #3 in line",
    "Queued · #4 in line",
  ]);
  expect((await names()).map((n) => n.split(" - ")[1])).toEqual([
    "Instagram Reel 720x1280.mp4",
    "720x1280.mov",
    "720x1280.webm",
    "720x1280.gif",
    "1080x1920.mp4",
  ]);
  // And a step down for the WebM: it swaps with the GIF.
  await rows(page).nth(2).getByRole("button", { name: "↓" }).click();
  await expect(rows(page).nth(3).locator(".export-job-name")).toContainText(".webm");
  await rows(page).nth(3).getByRole("button", { name: "↑" }).click();
  await expect(rows(page).nth(2).locator(".export-job-name")).toContainText(".webm");

  // Cancel the last one while it's waiting: it drops out of the line (and down to the history).
  await rows(page).nth(4).getByRole("button", { name: "Cancel" }).click();
  await expect(rows(page).nth(4).locator(".export-job-status")).toHaveText("Cancelled");
  await expect(rows(page).nth(3).locator(".export-job-status")).toHaveText("Queued · #3 in line");
  await expect(rows(page).nth(4).getByRole("button", { name: "Remove" })).toBeVisible();

  // Cancel the one rendering: it stops, its half-written file goes, and the MOV — now first in
  // line — starts.
  await expect(rows(page).nth(0).locator(".export-job-status")).toHaveText(/Rendering… [1-9]\d*%/, { timeout: 60_000 });
  await rows(page).nth(0).getByRole("button", { name: "Cancel" }).click();
  await expect(rows(page).nth(0).locator(".export-job-status")).toHaveText(/Rendering…/, { timeout: 15_000 });
  await expect(rows(page).nth(0).locator(".export-job-name")).toContainText(".mov");
  const jobs = await listJobs(projectId); // the service lists by creation: mp4, webm, gif, mov, 1080p
  expect(jobs).toHaveLength(5);
  expect(jobs.map((j) => j.status)).toEqual(["cancelled", "queued", "queued", "running", "cancelled"]);
  await expect.poll(() => readdirSync(jobDir(jobs[0]))).toEqual(["job.json"]);
  expect(readdirSync(jobDir(jobs[4]))).toEqual(["job.json"]);
  expect(await statuses(page)).toEqual([
    expect.stringMatching(/^Rendering…/),
    "Queued · #1 in line",
    "Queued · #2 in line",
    "Cancelled",
    "Cancelled",
  ]);

  // A reload in the middle: the queue is the service's, so it's all still there.
  await page.reload();
  await expect(page.locator(".export-button")).toHaveText(/^Exporting 3 · \d+%$/, { timeout: 15_000 });
  await page.locator(".export-button").click();
  await expect(rows(page)).toHaveCount(5);
  expect((await statuses(page))[0]).toMatch(/^Rendering…/);
  expect((await names())[0]).toContain(".mov");

  // The rest finish, in the (new) order — the history is then newest batch first, as asked for.
  await expect(rows(page).filter({ hasText: /Rendering…|Queued/ })).toHaveCount(0, { timeout: 300_000 });
  expect((await names()).map((n) => n.split(" - ")[1])).toEqual([
    "Instagram Reel 720x1280.mp4",
    "720x1280.webm",
    "720x1280.gif",
    "720x1280.mov",
    "1080x1920.mp4",
  ]);
  expect(await statuses(page)).toEqual([
    "Cancelled",
    expect.stringMatching(/^Done · /),
    expect.stringMatching(/^Done · /),
    expect.stringMatching(/^Done · /),
    "Cancelled",
  ]);
  await expect(page.locator(".export-button")).toHaveCount(0); // the panel is open, not the button

  const expected: Array<[string, string]> = [
    ["Untitled reel - 720x1280.webm", "matroska,webm"],
    ["Untitled reel - 720x1280.gif", "gif"],
    ["Untitled reel - 720x1280.mov", "mov,mp4,m4a,3gp,3g2,mj2"],
  ];
  for (const [name, container] of expected) {
    const row = rows(page).filter({ has: page.locator(".export-job-name", { hasText: name }) });
    const [download] = await Promise.all([page.waitForEvent("download"), row.getByRole("link", { name: "Download" }).click()]);
    expect(download.suggestedFilename()).toBe(name);
    expect(containerOf(await saveDownload(download))).toBe(container);
  }

  // Clearing the finished ones deletes them from disk; the batch folder goes with the last one.
  await page.getByRole("button", { name: "Clear finished" }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect.poll(() => existsSync(path.join(E2E_EXPORTS_ROOT, jobs[0].batchId)), { timeout: 10_000 }).toBe(false);
  expect(await listJobs(projectId)).toEqual([]);
});
