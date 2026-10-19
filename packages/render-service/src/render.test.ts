import { describe, expect, it } from "vitest";
import { createDamageDetector, damagedInputWarning, explainFfmpegFailure, inputPathsOf, shortOutputWarning } from "./render.js";

const inputs = ["/exports/b1/media/abc.mp4", "/exports/b1/media/abc.mp4", "/exports/b1/media/def.m4a"];
const labels = { "/exports/b1/media/abc.mp4": "beach.mp4", "/exports/b1/media/def.m4a": "music.m4a" };

// What ffmpeg 6 prints for a faststart mp4 whose data was cut off half-way (captured from a real run).
const TRUNCATED_RUN = [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/exports/b1/media/abc.mp4':",
  "  Duration: 00:00:30.00, start: 0.000000, bitrate: 165 kb/s",
  "[NULL @ 0x55] Invalid NAL unit size (3678 > 493).",
  "[mov,mp4,m4a,3gp,3g2,mj2 @ 0x55] stream 0, offset 0x1305a2: partial file",
  "[vist#0:0/h264 @ 0x55] Error submitting packet to decoder: Invalid data found when processing input",
  "frame=  900 fps=0.0 q=-1.0 Lsize=     200kB time=00:00:30.00",
].join("\n");

describe("createDamageDetector", () => {
  it("spots ffmpeg's complaints about an input, fed in arbitrary chunks, and names the file", () => {
    const detector = createDamageDetector(inputs, labels);
    for (let i = 0; i < TRUNCATED_RUN.length; i += 7) detector.feed(TRUNCATED_RUN.slice(i, i + 7));
    const report = detector.report()!;
    expect(report.labels).toEqual(["beach.mp4"]);
    expect(report.lines).toHaveLength(3);
    expect(report.lines[1]).toContain("partial file");
  });

  it("attributes by the input index ffmpeg tags decoder messages with, so the second input is named, not the first", () => {
    const detector = createDamageDetector(inputs, labels);
    detector.feed("[aist#2:0/aac @ 0x1] Error while decoding stream #2:0: Invalid data found when processing input\n");
    expect(detector.report()!.labels).toEqual(["music.m4a"]);
  });

  it("reports nothing for a clean run, and 'one of the source files' when a complaint names no input", () => {
    expect(createDamageDetector(inputs, labels).report()).toBeNull();
    const detector = createDamageDetector(inputs, labels);
    detector.feed("[mov @ 0x1] stream 0, offset 0x13: partial file\n");
    expect(detector.report()!.labels).toEqual([]);
    expect(damagedInputWarning(detector.report())).toContain("one of the source files");
  });

  it("lists the -i arguments in order", () => {
    expect(inputPathsOf(["-y", "-threads", "1", "-i", "/a.mp4", "-i", "/b.m4a", "-filter_complex", "x"])).toEqual(["/a.mp4", "/b.m4a"]);
  });
});

describe("explainFfmpegFailure", () => {
  it("names the damaged file when ffmpeg said an input couldn't be read through", () => {
    const detector = createDamageDetector(inputs, labels);
    detector.feed(TRUNCATED_RUN);
    const message = explainFfmpegFailure(1, "tail", detector.report());
    expect(message).toContain('couldn\'t read "beach.mp4" all the way through');
    expect(message).toContain("damaged or incomplete");
    expect(message).toContain("tail"); // the raw detail is still there, underneath
  });

  it("keeps the drawtext explanation, and the plain exit-code message for anything else", () => {
    expect(explainFfmpegFailure(1, "No such filter: 'drawtext'", null)).toContain("libfreetype");
    expect(explainFfmpegFailure(137, "Killed", null)).toBe("ffmpeg exited with code 137.\nKilled");
  });
});

describe("warnings on a finished export", () => {
  it("says which file was unreadable and what that did to the result", () => {
    const detector = createDamageDetector(inputs, labels);
    detector.feed(TRUNCATED_RUN);
    const warning = damagedInputWarning(detector.report())!;
    expect(warning).toContain('unreadable data in "beach.mp4"');
    expect(warning).toContain("frozen frame and silence");
    expect(damagedInputWarning(null)).toBeNull();
  });

  it("warns when the file is clearly shorter than the timeline, and not for rounding or an unreadable probe", () => {
    expect(shortOutputWarning(30, 15)).toContain("15.0s long, not the 30.0s");
    expect(shortOutputWarning(30, 29.8)).toBeNull();
    expect(shortOutputWarning(30, 30.02)).toBeNull();
    expect(shortOutputWarning(30, null)).toBeNull();
  });
});
