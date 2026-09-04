import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Request, RequestHandler, Response } from "express";
import multer from "multer";
import { buildAudioEditFilterArgs, buildAudioEditInputArgs, type AudioEditSpec } from "@reel-studio/timeline-core";

const TMP_ROOT = path.join(os.tmpdir(), "reel-studio-audio-edit");
const STDERR_TAIL_LIMIT = 4000;

// mp3/m4a/opus are re-encoded at the requested bitrate; wav is 16-bit PCM (bitrate ignored). The
// client can also produce wav entirely in-browser — this path exists so a wav export goes through
// the same trim/fade/gain/speed pipeline as every other format.
const FORMATS = {
  mp3: { ext: "mp3", codec: "libmp3lame", mime: "audio/mpeg", lossy: true },
  m4a: { ext: "m4a", codec: "aac", mime: "audio/mp4", lossy: true },
  opus: { ext: "opus", codec: "libopus", mime: "audio/opus", lossy: true },
  wav: { ext: "wav", codec: "pcm_s16le", mime: "audio/wav", lossy: false },
} as const;
type FormatId = keyof typeof FORMATS;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req: Request, _file, cb) => {
      const dir = path.join(TMP_ROOT, (req.audioEditId ??= randomUUID()));
      mkdir(dir, { recursive: true })
        .then(() => cb(null, dir))
        .catch((err) => cb(err as Error, dir));
    },
    filename: (_req, file, cb) => cb(null, `input${path.extname(file.originalname) || ""}`),
  }),
});

export const audioEditUpload: RequestHandler = upload.single("file");

function parseSpec(raw: unknown): AudioEditSpec | null {
  if (typeof raw !== "string") return null;
  try {
    const s = JSON.parse(raw) as Partial<AudioEditSpec>;
    if (typeof s.trimStartSec !== "number" || typeof s.trimEndSec !== "number") return null;
    return {
      trimStartSec: s.trimStartSec,
      trimEndSec: s.trimEndSec,
      fadeInSec: Number(s.fadeInSec) || 0,
      fadeOutSec: Number(s.fadeOutSec) || 0,
      gainDb: Number(s.gainDb) || 0,
      speed: Number(s.speed) > 0 ? Number(s.speed) : 1,
    };
  } catch {
    return null;
  }
}

// Synchronous by design: an audio-only ffmpeg pass on a normal-length track is a couple of seconds,
// so there's no job/SSE/polling machinery here the way /render needs — the request just holds open
// until the file is ready, then streams it back.
export async function handleAudioEdit(req: Request, res: Response): Promise<void> {
  const workDir = req.audioEditId ? path.join(TMP_ROOT, req.audioEditId) : null;
  const cleanup = () => {
    if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {});
  };

  if (!req.file || !workDir) {
    res.status(400).json({ error: "Missing audio file" });
    cleanup();
    return;
  }

  const spec = parseSpec(req.body.spec);
  if (!spec) {
    res.status(400).json({ error: "Missing or invalid edit spec" });
    cleanup();
    return;
  }

  const formatId = (String(req.body.format) as FormatId) in FORMATS ? (String(req.body.format) as FormatId) : "mp3";
  const format = FORMATS[formatId];
  const bitrateKbps = Math.min(Math.max(Number(req.body.bitrateKbps) || 192, 32), 320);

  const outputName = `output.${format.ext}`;
  const args = [
    "-y",
    ...buildAudioEditInputArgs(spec),
    "-i",
    req.file.path,
    ...buildAudioEditFilterArgs(spec),
    "-vn",
    "-c:a",
    format.codec,
    ...(format.lossy ? ["-b:a", `${bitrateKbps}k`] : []),
    outputName,
  ];

  const ffmpeg = spawn("ffmpeg", args, { cwd: workDir });
  let stderrTail = "";
  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    stderrTail += chunk.toString("utf8");
    if (stderrTail.length > STDERR_TAIL_LIMIT) stderrTail = stderrTail.slice(-STDERR_TAIL_LIMIT);
  });

  ffmpeg.on("error", (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: `Failed to start ffmpeg: ${err.message}. Is ffmpeg installed and on PATH?` });
    }
    cleanup();
  });

  ffmpeg.on("close", (code) => {
    if (res.headersSent) {
      cleanup();
      return;
    }
    if (code !== 0) {
      res.status(422).json({ error: `ffmpeg exited with code ${code}.\n${stderrTail}` });
      cleanup();
      return;
    }
    res.download(path.join(workDir, outputName), `${req.body.name || "audio"}.${format.ext}`, () => cleanup());
  });
}
