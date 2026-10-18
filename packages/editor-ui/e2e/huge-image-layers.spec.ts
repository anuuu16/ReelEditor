import { expect, test } from "@playwright/test";
import {
  decodeInPage,
  downloadExport,
  formatOf,
  loadPhoto,
  MIME,
  openFreshEditor,
  percentile,
  SAMPLES,
  selectFormat,
  selectionCenter,
  setSlider,
  takeRenderTimings,
} from "./helpers.js";

// The 9000×6000 photo is the worst case for interactivity: every preview render draws it
// scaled. Layers must still drag smoothly (the photo pass is cached), and export must finish.
test("huge photo with blended layers stays interactive and exports", async ({ page }) => {
  await openFreshEditor(page);
  const loadMs = await loadPhoto(page, SAMPLES.huge);

  await page.getByRole("button", { name: "+ Text" }).click();
  await page.locator("textarea").fill("Blend test");
  await page.locator(".ie-section:has(h3:text-is('Blend')) select").selectOption("overlay");

  await page.getByRole("button", { name: "+ Shape" }).click();
  await page.locator(".ie-shape-menu button", { hasText: "ellipse" }).click();
  await page.locator(".ie-section:has(h3:text-is('Blend')) select").selectOption("multiply");
  await setSlider(page, "Opacity", 0.7);

  await page.locator(".ie-layer-add input[type=file]").setInputFiles(SAMPLES.logo);
  await page.locator(".ie-layer-row", { hasText: "logo-transparent" }).waitFor();
  await page.locator(".ie-section:has(h3:text-is('Blend')) select").selectOption("screen");

  await page.getByRole("button", { name: "+ Sticker" }).click();
  await page.locator(".ie-sticker-menu button").first().click();
  await page.locator(".ie-section:has(h3:text-is('Blend')) select").selectOption("difference");

  const rows = await page.locator(".ie-layer-row .ie-layer-name > span").allInnerTexts();
  expect(rows).toHaveLength(5); // 4 layers + Photo

  // Drag the sticker (currently selected) across the canvas and time every preview render.
  await takeRenderTimings(page);
  const start = await selectionCenter(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const dragStarted = Date.now();
  const steps = 40;
  for (let i = 1; i <= steps; i++) await page.mouse.move(start.x - i * 4, start.y + i * 3);
  await page.mouse.up();
  const dragMs = Date.now() - dragStarted;
  const timings = await takeRenderTimings(page);
  const after = await selectionCenter(page);
  expect(after.x - start.x).toBeCloseTo(-steps * 4, -1);
  expect(after.y - start.y).toBeCloseTo(steps * 3, -1);

  // Budget: the cached photo pass means a layer drag should be far cheaper than re-drawing 54 Mpx.
  const p50 = percentile(timings, 50);
  const p95 = percentile(timings, 95);
  expect(timings.length).toBeGreaterThan(10);
  expect(p95).toBeLessThan(120);

  // A photo change DOES redraw the photo — one expensive render, then cheap again.
  await takeRenderTimings(page);
  await page.locator(".ie-context-switch button:text-is('Photo')").click();
  await setSlider(page, "Saturation", 1.3);
  await page.waitForTimeout(200);
  const photoRedraw = await takeRenderTimings(page);

  await selectFormat(page, "PNG");
  const png = await downloadExport(page);
  expect(formatOf(png.bytes)).toBe("PNG");
  const decoded = await decodeInPage(page, png.bytes, MIME.PNG);
  expect([decoded.width, decoded.height]).toEqual([1080, 1920]);

  await selectFormat(page, "JPEG");
  const jpeg = await downloadExport(page);
  expect(formatOf(jpeg.bytes)).toBe("JPEG");

  console.log(
    [
      `\n[huge photo + 4 blended layers]`,
      `  load ${loadMs} ms`,
      `  drag: ${steps} pointer moves in ${dragMs} ms → ${timings.length} renders, p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${Math.max(...timings).toFixed(1)} ms`,
      `  photo adjustment redraw: ${photoRedraw.map((t) => t.toFixed(1)).join(", ")} ms`,
      `  export PNG ${png.bytes.length} B in ${png.ms} ms · JPEG ${jpeg.bytes.length} B in ${jpeg.ms} ms`,
    ].join("\n"),
  );
});
