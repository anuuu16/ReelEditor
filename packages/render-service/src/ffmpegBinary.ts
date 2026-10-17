import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";

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
