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

// A poem that arrives without scenes (e.g. hand pasted) still needs a timeline — split its lines
// into `sceneCount` roughly equal chunks at 8 seconds each rather than leaving it untimed.
export function deriveScenesFromPoem(poem: string, sceneCount: number): RhymeScene[] {
  const lines = poem.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const perScene = Math.max(1, Math.ceil(lines.length / sceneCount));
  const scenes: RhymeScene[] = [];
  for (let i = 0; i < lines.length; i += perScene) {
    scenes.push({ lines: lines.slice(i, i + perScene).join("\n"), seconds: 8 });
  }
  return scenes;
}
