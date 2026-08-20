import type { RhymeScene } from "./rhymeTypes.js";

export interface TimedScene extends RhymeScene {
  start: number;
  end: number;
}

export function computeTiming(scenes: RhymeScene[]): { timed: TimedScene[]; total: number } {
  let running = 0;
  const timed = scenes.map((scene) => {
    const dur = Math.max(3, scene.seconds || 8);
    const start = running;
    const end = start + dur;
    running = end;
    return { ...scene, start, end };
  });
  return { timed, total: running };
}

export function formatMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// A poem that arrives without scenes (e.g. hand pasted) still needs a timeline — split each
// language's lines into `sceneCount` roughly equal chunks at 8 seconds each rather than leaving it
// untimed. All languages are split the same way so they stay aligned scene by scene.
export function deriveScenesFromPoems(poems: Record<string, string>, sceneCount: number): RhymeScene[] {
  const languages = Object.keys(poems);
  const linesByLanguage = languages.map((lang) => ({
    lang,
    lines: (poems[lang] ?? "").split("\n").filter((l) => l.trim().length > 0),
  }));
  const maxLines = Math.max(0, ...linesByLanguage.map((l) => l.lines.length));
  if (maxLines === 0) return [];
  const perScene = Math.max(1, Math.ceil(maxLines / sceneCount));

  const scenes: RhymeScene[] = [];
  for (let i = 0; i < maxLines; i += perScene) {
    const lines: Record<string, string> = {};
    for (const { lang, lines: langLines } of linesByLanguage) {
      lines[lang] = langLines.slice(i, i + perScene).join("\n");
    }
    scenes.push({ lines, seconds: 8 });
  }
  return scenes;
}
