import { describe, expect, it } from "vitest";
import {
  buildDownloadName,
  buildEncoderArgs,
  dedupeFileNames,
  getOutputFormat,
  isOutputFormatId,
  OUTPUT_FORMATS,
  sanitizeFileStem,
} from "./export-formats.js";

describe("output formats", () => {
  it("knows every id it lists, and nothing else", () => {
    for (const format of OUTPUT_FORMATS) expect(isOutputFormatId(format.id)).toBe(true);
    expect(isOutputFormatId("avi")).toBe(false);
    expect(isOutputFormatId(undefined)).toBe(false);
    expect(getOutputFormat("webm").extension).toBe("webm");
  });

  it("encodes mp4 and mov as H.264/AAC, webm as VP9/Opus, and leaves gif to the filter graph", () => {
    expect(buildEncoderArgs("mp4").join(" ")).toContain("-c:v libx264");
    expect(buildEncoderArgs("mp4").join(" ")).toContain("-movflags +faststart");
    expect(buildEncoderArgs("mov")).toEqual(buildEncoderArgs("mp4"));
    expect(buildEncoderArgs("webm").join(" ")).toContain("-c:v libvpx-vp9");
    expect(buildEncoderArgs("webm").join(" ")).toContain("-c:a libopus");
    expect(buildEncoderArgs("gif")).toEqual([]);
    expect(getOutputFormat("gif").hasAudio).toBe(false);
  });
});

describe("download names", () => {
  it("strips what a file system won't take and keeps the rest readable", () => {
    expect(sanitizeFileStem('Summer: "Beach" day / take 2')).toBe("Summer Beach day take 2");
    expect(sanitizeFileStem("  ..hidden..  ")).toBe("hidden");
    expect(sanitizeFileStem("a\u0000b\tc")).toBe("a b c");
    expect(sanitizeFileStem("x".repeat(200))).toHaveLength(120);
    expect(sanitizeFileStem("Été à Paris — reel #1")).toBe("Été à Paris — reel #1");
  });

  it("puts the project, the preset and the size in the name, with the format's extension", () => {
    expect(buildDownloadName({ projectName: "My reel", width: 1080, height: 1920, format: "mp4", label: "Instagram Reel" })).toBe(
      "My reel - Instagram Reel 1080x1920.mp4",
    );
    expect(buildDownloadName({ projectName: "My reel", width: 540, height: 960, format: "gif" })).toBe("My reel - 540x960.gif");
    expect(buildDownloadName({ projectName: "   ", width: 1080, height: 1080, format: "webm", label: null })).toBe("reel - 1080x1080.webm");
  });

  it("numbers duplicates so two identical outputs don't overwrite each other", () => {
    expect(dedupeFileNames(["a.mp4", "b.mp4", "a.mp4", "a.mp4", "noext"])).toEqual(["a.mp4", "b.mp4", "a (2).mp4", "a (3).mp4", "noext"]);
    expect(dedupeFileNames(["x", "x"])).toEqual(["x", "x (2)"]);
  });
});
