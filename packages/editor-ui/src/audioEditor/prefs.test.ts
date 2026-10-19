import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, loadPrefs, savePrefs } from "./prefs.js";

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

describe("audio editor prefs", () => {
  it("round-trips through storage", () => {
    const storage = memoryStorage();
    savePrefs({ loudnessTargetId: "broadcast", exportFormat: "opus", bitrateKbps: 128, peakSafeExport: false }, storage);
    expect(loadPrefs(storage)).toEqual({ loudnessTargetId: "broadcast", exportFormat: "opus", bitrateKbps: 128, peakSafeExport: false });
  });

  it("falls back to defaults when nothing is stored, or storage is unavailable", () => {
    expect(loadPrefs(memoryStorage())).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it("ignores garbage and unknown values field by field", () => {
    const storage = memoryStorage();
    storage.setItem(
      "reel-studio:audio-editor:prefs",
      JSON.stringify({ exportFormat: "flac", bitrateKbps: "x", loudnessTargetId: "podcast" }),
    );
    expect(loadPrefs(storage)).toEqual({ ...DEFAULT_PREFS, loudnessTargetId: "podcast" });
    storage.setItem("reel-studio:audio-editor:prefs", "{not json");
    expect(loadPrefs(storage)).toEqual(DEFAULT_PREFS);
  });
});
