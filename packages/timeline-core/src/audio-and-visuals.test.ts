import { describe, expect, it } from "vitest";
import { computeEffectiveVolume, computeFadeMultiplier } from "./audio-mix.js";
import { buildAtempoFilters, buildAudioEditFilter, buildAudioEditFilterArgs, buildAudioEditInputArgs } from "./audio-edit.js";
import { applyPanZoom, buildPanZoomFilter, computeFitRect } from "./fit-rect.js";
import { applyFilterPreset, buildCanvasFilterString, buildFfmpegColorFilter, NEUTRAL_FILTER } from "./filter-presets.js";
import { computeOverlayAlpha, computeOverlayPopScale, computeOverlaySlideOffsetRatio, isOverlayActive } from "./overlay-animation.js";
import { computeExportDimensions } from "./quality-presets.js";

describe("computeFitRect (landscape clip on a 9:16 canvas)", () => {
  it("fit: whole clip visible, centred with bars", () => {
    expect(computeFitRect(1080, 1920, 1920, 1080, "fit")).toEqual({ x: 0, y: 656.25, width: 1080, height: 607.5 });
  });

  it("fill: covers the canvas, cropped at the sides", () => {
    const rect = computeFitRect(1080, 1920, 1920, 1080, "fill");
    expect(rect.height).toBe(1920);
    expect(rect.width).toBeCloseTo(3413.33, 1);
    expect(rect.x).toBeCloseTo(-1166.67, 1);
  });

  it("stretch: exactly the canvas", () => {
    expect(computeFitRect(1080, 1920, 1920, 1080, "stretch")).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  });
});

describe("pan and zoom", () => {
  it("zooms around the centre", () => {
    const rect = applyPanZoom({ x: 0, y: 0, width: 100, height: 100 }, { scale: 2, x: 0, y: 0, rotation: 0 }, 100, 100);
    expect(rect).toEqual({ x: -50, y: -50, width: 200, height: 200 });
  });

  it("adds no ffmpeg filter for a neutral transform", () => {
    expect(buildPanZoomFilter({ scale: 1, x: 0, y: 0, rotation: 0 }, 1080, 1920)).toBe("");
  });

  it("zooms into the centre of the frame in ffmpeg", () => {
    expect(buildPanZoomFilter({ scale: 2, x: 0, y: 0, rotation: 0 }, 1000, 2000)).toBe(
      ",scale=2000:4000,crop=1000:2000:500:1000,pad=1000:2000:0:0:color=black",
    );
  });

  it("pans at 1x zoom, leaving black where the picture moved away — as the preview draws it", () => {
    // Preview: the frame is drawn 200 px to the left, so canvas x 0..800 shows source x 200..1000.
    const rect = applyPanZoom({ x: 0, y: 0, width: 1000, height: 2000 }, { scale: 1, x: 0.2, y: 0, rotation: 0 }, 1000, 2000);
    expect(rect.x).toBe(-200);
    expect(buildPanZoomFilter({ scale: 1, x: 0.2, y: 0, rotation: 0 }, 1000, 2000)).toBe(
      ",scale=1000:2000,crop=800:2000:200:0,pad=1000:2000:0:0:color=black",
    );
    expect(buildPanZoomFilter({ scale: 1, x: -0.2, y: 0, rotation: 0 }, 1000, 2000)).toBe(
      ",scale=1000:2000,crop=800:2000:0:0,pad=1000:2000:200:0:color=black",
    );
  });
});

describe("computeFadeMultiplier", () => {
  it("ramps in and out", () => {
    expect(computeFadeMultiplier(1, 1, 0.5, 4)).toBe(0.5);
    expect(computeFadeMultiplier(1, 1, 2, 4)).toBe(1);
    expect(computeFadeMultiplier(1, 1, 3.5, 4)).toBe(0.5);
  });

  it("caps a fade at half the clip", () => {
    expect(computeFadeMultiplier(10, 0, 1, 4)).toBe(0.5);
  });
});

describe("computeEffectiveVolume", () => {
  const clip = { volume: 1, muted: false, fadeInSeconds: 0, fadeOutSeconds: 0 };

  it("is silent when muted", () => {
    expect(computeEffectiveVolume({ ...clip, muted: true }, 1, 4)).toBe(0);
  });

  it("clamps volume to 1", () => {
    expect(computeEffectiveVolume({ ...clip, volume: 1.5 }, 1, 4)).toBe(1);
  });
});

describe("audio edit", () => {
  it("stacks atempo for speeds outside 0.5–2", () => {
    expect(buildAtempoFilters(1)).toEqual([]);
    expect(buildAtempoFilters(1.5)).toEqual(["atempo=1.5000"]);
    expect(buildAtempoFilters(4)).toEqual(["atempo=2.0000", "atempo=2.0000"]);
    expect(buildAtempoFilters(0.25)).toEqual(["atempo=0.5000", "atempo=0.5000"]);
    expect(buildAtempoFilters(0)).toEqual([]);
  });

  it("builds fades, then gain", () => {
    const spec = { trimStartSec: 0, trimEndSec: 10, fadeInSec: 1, fadeOutSec: 2, gainDb: 3, speed: 1 };
    expect(buildAudioEditFilter(spec)).toBe("afade=t=in:st=0:d=1.000,afade=t=out:st=8.000:d=2.000,volume=3.00dB");
  });

  it("adds no filter for a bare trim", () => {
    expect(buildAudioEditFilterArgs({ trimStartSec: 1, trimEndSec: 3, fadeInSec: 0, fadeOutSec: 0, gainDb: 0, speed: 1 })).toEqual([]);
  });

  it("keeps the end after the start", () => {
    expect(buildAudioEditInputArgs({ trimStartSec: 5, trimEndSec: 2, fadeInSec: 0, fadeOutSec: 0, gainDb: 0, speed: 1 })).toEqual([
      "-ss",
      "5.000",
      "-to",
      "5.010",
    ]);
  });
});

describe("colour filters", () => {
  it("neutral filter in CSS and ffmpeg", () => {
    expect(buildCanvasFilterString(NEUTRAL_FILTER)).toBe("brightness(1) contrast(1) saturate(1) hue-rotate(0deg)");
    expect(buildFfmpegColorFilter(NEUTRAL_FILTER)).toBe("eq=brightness=0:contrast=1:saturation=1");
  });

  it("adds a hue filter only when hue is set", () => {
    expect(buildFfmpegColorFilter({ ...NEUTRAL_FILTER, hue: 10 })).toBe("eq=brightness=0:contrast=1:saturation=1,hue=h=10");
  });

  it("applies presets", () => {
    expect(applyFilterPreset("none").preset).toBeNull();
    expect(applyFilterPreset("mono")).toMatchObject({ preset: "mono", saturation: 0 });
  });
});

describe("overlay animation", () => {
  const overlay = { start: 0, end: 4, position: { x: 0.2, y: 0.5 } };

  it("fades in and out", () => {
    expect(computeOverlayAlpha({ ...overlay, animation: "fade" }, 0.2)).toBeCloseTo(0.5);
    expect(computeOverlayAlpha({ ...overlay, animation: "fade" }, 2)).toBe(1);
    expect(computeOverlayAlpha({ ...overlay, animation: "fade" }, 3.9)).toBeCloseTo(0.25);
    expect(computeOverlayAlpha({ ...overlay, animation: "none" }, 0)).toBe(1);
  });

  it("pops from half size", () => {
    expect(computeOverlayPopScale({ ...overlay, animation: "pop" }, 0)).toBe(0.5);
    expect(computeOverlayPopScale({ ...overlay, animation: "pop" }, 0.2)).toBeCloseTo(0.75);
    expect(computeOverlayPopScale({ ...overlay, animation: "pop" }, 1)).toBe(1);
  });

  it("slides in from the nearer edge", () => {
    expect(computeOverlaySlideOffsetRatio({ ...overlay, animation: "slide-in" }, 0)).toBeCloseTo(-0.6);
    expect(computeOverlaySlideOffsetRatio({ ...overlay, position: { x: 0.8, y: 0.5 }, animation: "slide-in" }, 0)).toBeCloseTo(0.6);
    expect(computeOverlaySlideOffsetRatio({ ...overlay, animation: "slide-in" }, 1)).toBeCloseTo(0);
  });

  it("is active from start up to, not including, end", () => {
    expect(isOverlayActive(overlay, 0)).toBe(true);
    expect(isOverlayActive(overlay, 4)).toBe(false);
  });
});

describe("computeExportDimensions", () => {
  it("scales the canvas for each quality", () => {
    expect(computeExportDimensions(1080, 1920, 2 / 3)).toEqual({ width: 720, height: 1280 });
    expect(computeExportDimensions(1080, 1920, 4 / 3)).toEqual({ width: 1440, height: 2560 });
  });

  it("rounds to even numbers (H.264 needs them)", () => {
    expect(computeExportDimensions(1001, 999, 1)).toEqual({ width: 1002, height: 1000 });
  });
});
