import { describe, expect, it } from "vitest";
import { createProgressParser, type ProgressUpdate } from "./ffmpegProgress.js";

describe("createProgressParser", () => {
  it("reports out_time at each progress= line", () => {
    const updates: ProgressUpdate[] = [];
    const feed = createProgressParser((u) => updates.push(u));
    feed("frame=10\nout_time=00:00:01.500000\nprogress=continue\nframe=20\nout_time=00:01:02.250000\nprogress=end\n");
    expect(updates).toEqual([
      { outTimeSeconds: 1.5, done: false },
      { outTimeSeconds: 62.25, done: true },
    ]);
  });

  it("handles a key=value pair split across two chunks", () => {
    const updates: ProgressUpdate[] = [];
    const feed = createProgressParser((u) => updates.push(u));
    feed("out_time=00:00:0");
    feed("3.000000\nprogress=continue\n");
    expect(updates).toEqual([{ outTimeSeconds: 3, done: false }]);
  });

  it("ignores lines it doesn't understand (and a malformed timecode reads as 0)", () => {
    const updates: ProgressUpdate[] = [];
    const feed = createProgressParser((u) => updates.push(u));
    feed("garbage\nout_time=N/A\nprogress=continue\n");
    expect(updates).toEqual([{ outTimeSeconds: 0, done: false }]);
  });
});
