// Audio Editor UI preferences that should survive a reload but aren't part of the timeline itself
// (so they're not undoable and don't live in the project record): the loudness meter's reference
// target, and the export format choices. localStorage, one JSON blob, tolerant of missing/garbage.
import type { AudioExportFormat } from "./api.js";

export interface AudioEditorPrefs {
  loudnessTargetId: string;
  exportFormat: AudioExportFormat;
  bitrateKbps: number;
  peakSafeExport: boolean;
}

export const DEFAULT_PREFS: AudioEditorPrefs = {
  loudnessTargetId: "social",
  exportFormat: "mp3",
  bitrateKbps: 192,
  peakSafeExport: true,
};

const KEY = "reel-studio:audio-editor:prefs";

export function loadPrefs(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage,
): AudioEditorPrefs {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<AudioEditorPrefs>;
    return {
      loudnessTargetId: typeof parsed.loudnessTargetId === "string" ? parsed.loudnessTargetId : DEFAULT_PREFS.loudnessTargetId,
      exportFormat: ["mp3", "m4a", "opus", "wav"].includes(parsed.exportFormat as string)
        ? (parsed.exportFormat as AudioExportFormat)
        : DEFAULT_PREFS.exportFormat,
      bitrateKbps: Number.isFinite(parsed.bitrateKbps) ? (parsed.bitrateKbps as number) : DEFAULT_PREFS.bitrateKbps,
      peakSafeExport: typeof parsed.peakSafeExport === "boolean" ? parsed.peakSafeExport : DEFAULT_PREFS.peakSafeExport,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(
  prefs: AudioEditorPrefs,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage,
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage full/blocked — preferences just won't persist this session */
  }
}
