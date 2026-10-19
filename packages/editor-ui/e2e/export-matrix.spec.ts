import { expect, test } from "@playwright/test";
import {
  decodeInPage,
  downloadExport,
  formatOf,
  loadPhoto,
  MIME,
  openFreshEditor,
  SAMPLES,
  selectFormat,
  setSlider,
  type Format,
} from "./helpers.js";

const FORMATS: Format[] = ["PNG", "JPEG", "WebP"];

interface Sample {
  name: string;
  file: string;
  /** Natural size after EXIF orientation — what the Source section should report. */
  natural: string;
  transparentSource: boolean;
}

const SAMPLE_SET: Sample[] = [
  { name: "huge 9000×6000", file: SAMPLES.huge, natural: "9000×6000", transparentSource: false },
  { name: "tiny 160×90", file: SAMPLES.tiny, natural: "160×90", transparentSource: false },
  { name: "transparent logo", file: SAMPLES.logo, natural: "", transparentSource: true },
  { name: "phone photo (EXIF rotated)", file: SAMPLES.phone, natural: "", transparentSource: false },
];

// Every sample through every format, at the default 9:16 frame with rounded corners — which is
// where transparency handling differs per format — and once more at the source's own pixel size.
for (const sample of SAMPLE_SET) {
  test(`${sample.name}: exports in every format`, async ({ page }) => {
    await openFreshEditor(page);
    const loadMs = await loadPhoto(page, sample.file);
    const sourceLine = await page.locator(".ie-section:has(h3:text-is('Source')) .hint").last().innerText();
    if (sample.natural) expect(sourceLine).toContain(sample.natural);
    const rows: string[] = [`load ${loadMs} ms — ${sourceLine}`];

    await setSlider(page, "Corner radius", 25);

    for (const format of FORMATS) {
      await selectFormat(page, format);
      const { bytes, ms, fileName } = await downloadExport(page);
      expect(formatOf(bytes)).toBe(format);
      expect(fileName.endsWith(`.${format === "JPEG" ? "jpg" : format.toLowerCase()}`)).toBe(true);
      const decoded = await decodeInPage(page, bytes, MIME[format]);
      expect([decoded.width, decoded.height]).toEqual([1080, 1920]);
      if (format === "JPEG") {
        // No alpha channel: the rounded-off corner is flattened onto white, never black.
        expect(decoded.transparentPixels).toBe(0);
        expect(decoded.corner.slice(0, 3).every((c) => c >= 250)).toBe(true);
      } else {
        expect(decoded.corner[3]).toBe(0);
        expect(decoded.transparentPixels).toBeGreaterThan(0);
      }
      rows.push(
        `${format.padEnd(4)} ${String(bytes.length).padStart(9)} B  ${decoded.width}×${decoded.height}  export ${ms} ms  corner rgba(${decoded.corner.join(",")})`,
      );
    }

    // Source-size export ("Scale source → 100%") — for the huge photo that is a 9000×6000 file.
    await setSlider(page, "Corner radius", 0);
    await page.locator(".ie-section:has(h3:text-is('Output size')) button:text-is('100%')").click();
    await selectFormat(page, "PNG");
    const full = await downloadExport(page);
    const decodedFull = await decodeInPage(page, full.bytes, MIME.PNG);
    const hint = await page.locator(".ie-section:has(h3:text-is('Export')) .hint").first().innerText();
    expect(hint).toContain(`${decodedFull.width}×${decodedFull.height}`);
    if (sample.natural) expect(`${decodedFull.width}×${decodedFull.height}`).toBe(sample.natural);
    // With the default solid background every export is opaque — a transparent source included.
    expect(decodedFull.transparentPixels).toBe(0);
    rows.push(`PNG @100% ${String(full.bytes.length).padStart(9)} B  ${decodedFull.width}×${decodedFull.height}  export ${full.ms} ms`);

    if (sample.transparentSource) {
      // Background → Transparent keeps the source's alpha in PNG/WebP; JPEG flattens it onto white.
      await page.locator(".ie-section:has(h3:text-is('Background fill')) button:text-is('Transparent')").click();
      for (const format of FORMATS) {
        await selectFormat(page, format);
        const { bytes } = await downloadExport(page);
        const decoded = await decodeInPage(page, bytes, MIME[format]);
        expect([decoded.width, decoded.height]).toEqual([decodedFull.width, decodedFull.height]);
        if (format === "JPEG") {
          expect(decoded.transparentPixels).toBe(0);
          expect(decoded.corner.slice(0, 3).every((c) => c >= 250)).toBe(true);
        } else {
          expect(decoded.corner[3]).toBe(0);
          expect(decoded.transparentPixels).toBeGreaterThan(decoded.width * decoded.height * 0.1);
        }
        rows.push(
          `${format.padEnd(4)} @100% transparent bg ${String(bytes.length).padStart(7)} B  transparent px ${decoded.transparentPixels}  corner rgba(${decoded.corner.join(",")})`,
        );
      }
    }

    console.log(`\n[${sample.name}]\n  ${rows.join("\n  ")}`);
  });
}
