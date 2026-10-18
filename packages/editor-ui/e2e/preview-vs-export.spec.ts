import { expect, test } from "@playwright/test";
import { compareWithPreview, downloadExport, loadPhoto, MIME, openFreshEditor, SAMPLES, selectFormat, setSlider } from "./helpers.js";

/**
 * The promise the editor makes: what you see is what you get. A document using every layer kind
 * (text, shape, image, sticker) with blend modes, shadows, opacity and a rounded, bordered frame
 * is exported and the file is compared with the live preview canvas pixel by pixel.
 */
test("PNG export is pixel-identical to the preview (all four layer kinds)", async ({ page }) => {
  await openFreshEditor(page);
  await loadPhoto(page, SAMPLES.phone);

  // Photo look + frame.
  await setSlider(page, "Saturation", 1.2);
  await setSlider(page, "Corner radius", 20);
  await setSlider(page, "Border width", 16);

  // 1. Text — outline + shadow (default) + background pill, overlay blend.
  await page.getByRole("button", { name: "+ Text" }).click();
  await page.locator("textarea").fill("Preview == Export");
  await page.locator(".field:has(span:text-is('Outline')) button").click();
  await page.locator(".field:has(span:text-is('Background')) button").click();
  await page.locator(".ie-section:has(h3:text-is('Blend')) select").selectOption("overlay");

  // 2. Shape — star with shadow, 60% opacity, multiply.
  await page.getByRole("button", { name: "+ Shape" }).click();
  await page.locator(".ie-shape-menu button", { hasText: "star" }).click();
  await page.locator(".ie-section:has(h3:text-is('Effects')) .ie-color-row button").click();
  await setSlider(page, "Opacity", 0.6);
  await page.locator(".ie-section:has(h3:text-is('Blend')) select").selectOption("multiply");
  await setSlider(page, "Rotation", 20);

  // 3. Image — transparent logo, rounded, flipped, screen blend.
  await page.locator(".ie-layer-add input[type=file]").setInputFiles(SAMPLES.logo);
  await page.locator(".ie-layer-row", { hasText: "logo-transparent" }).waitFor();
  await setSlider(page, "Corner radius", 80);
  await page.getByRole("button", { name: "⇋ Flip H" }).click();
  await page.locator(".ie-section:has(h3:text-is('Blend')) select").selectOption("screen");

  // 4. Sticker — rotated.
  await page.getByRole("button", { name: "+ Sticker" }).click();
  await page.locator(".ie-sticker-menu button").nth(1).click();
  await setSlider(page, "Rotation", -15);

  const layers = await page.locator(".ie-layer-row .ie-layer-name > small").allInnerTexts();
  expect(layers.slice(0, 4).sort()).toEqual(["⭐", "image", "star", "Preview == Export"].sort());

  // Let the debounced autosave and size estimate settle so nothing re-renders mid-comparison.
  await page.getByText("Saved locally").waitFor();

  await selectFormat(page, "PNG");
  const png = await downloadExport(page);
  const pngResult = await compareWithPreview(page, png.bytes, MIME.PNG);
  expect(pngResult.sameSize).toBe(true);
  expect(pngResult.differingPixels).toBe(0);
  expect(pngResult.maxDiff).toBe(0);

  // Lossy formats: only codec noise, and the preview already shows the matte JPEG will use.
  await selectFormat(page, "JPEG");
  await page.waitForTimeout(100);
  const jpeg = await downloadExport(page);
  const jpegResult = await compareWithPreview(page, jpeg.bytes, MIME.JPEG);
  expect(jpegResult.sameSize).toBe(true);
  expect(jpegResult.meanDiff).toBeLessThan(2);

  await selectFormat(page, "WebP");
  await page.waitForTimeout(100);
  const webp = await downloadExport(page);
  const webpResult = await compareWithPreview(page, webp.bytes, MIME.WebP);
  expect(webpResult.sameSize).toBe(true);
  expect(webpResult.meanDiff).toBeLessThan(2);

  // Persistence round-trip: after a reload the project renders (and exports) the very same pixels.
  await page.reload();
  await page.locator("canvas.ie-canvas").waitFor();
  await page.locator(".ie-layer-row", { hasText: "logo-transparent" }).waitFor();
  await page.waitForTimeout(500);
  await selectFormat(page, "PNG");
  const pngAgain = await downloadExport(page);
  expect(pngAgain.bytes.equals(png.bytes)).toBe(true);

  console.log(
    [
      `\n[preview vs export — phone photo + text/shape/image/sticker]`,
      `  PNG : ${pngResult.width}×${pngResult.height}, differing pixels ${pngResult.differingPixels}, max channel diff ${pngResult.maxDiff}`,
      `  JPEG: mean channel diff ${jpegResult.meanDiff.toFixed(3)}/255, max ${jpegResult.maxDiff}`,
      `  WebP: mean channel diff ${webpResult.meanDiff.toFixed(3)}/255, max ${webpResult.maxDiff}`,
      `  PNG after reload byte-identical: ${pngAgain.bytes.equals(png.bytes)}`,
    ].join("\n"),
  );
});
