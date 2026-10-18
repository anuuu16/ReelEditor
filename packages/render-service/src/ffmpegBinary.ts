import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Which ffmpeg to run, in order:
//   1. FFMPEG_PATH, when set
//   2. `ffmpeg` on PATH (a system build — newer, and usually has drawtext for title overlays)
//   3. the binary from @ffmpeg-installer/ffmpeg, if that package has been added — not installed by default
//      (`pnpm --filter @reel-studio/render-service add @ffmpeg-installer/ffmpeg`, see README)
// Falls back to plain "ffmpeg" so the spawn error still says what's missing.
function resolveFfmpegPath(): string {
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv) return fromEnv;

  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) return "ffmpeg";

  try {
    const require = createRequire(import.meta.url);
    const bundled = (require("@ffmpeg-installer/ffmpeg") as { path: string }).path;
    try {
      // The platform package sets the executable bit in a postinstall script, which pnpm may skip.
      chmodSync(bundled, 0o755);
    } catch {
      // Read-only install: use it as it is.
    }
    return bundled;
  } catch {
    return "ffmpeg";
  }
}

export const FFMPEG_PATH = resolveFfmpegPath();

// Which ffprobe to run, in order:
//   1. FFPROBE_PATH, when set
//   2. the ffprobe that ships next to the resolved ffmpeg (same build, so it understands the same files)
//   3. `ffprobe` on PATH
// Returns null when none of those work: the @ffmpeg-installer package bundles only ffmpeg, so a
// missing ffprobe is normal, not an error — callers fall back to reading `ffmpeg -i` output instead.
function resolveFfprobePath(): string | null {
  const fromEnv = process.env.FFPROBE_PATH;
  if (fromEnv) return fromEnv;

  const candidates: string[] = [];
  if (path.isAbsolute(FFMPEG_PATH)) {
    candidates.push(path.join(path.dirname(FFMPEG_PATH), path.basename(FFMPEG_PATH).replace(/ffmpeg/, "ffprobe")));
  }
  candidates.push("ffprobe");

  for (const candidate of candidates) {
    if (spawnSync(candidate, ["-version"], { stdio: "ignore" }).status === 0) return candidate;
  }
  return null;
}

export const FFPROBE_PATH = resolveFfprobePath();
