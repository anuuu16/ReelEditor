// Ties loudness.ts's raw numbers + duck.ts's voice-activity detection + mixdown.ts's role-isolated
// rendering together into one "is this mix actually going to work" report for the UI. Lives apart
// from mixdown.ts (which this imports) specifically so mixdown.ts itself never has to import this
// — it's a one-way dependency, not a cycle.
import { buildDuckCurve, buildVoiceActivity } from "./duck.js";
import type { LoudnessMeasurement } from "./ebur128.js";
import { computeLoudnessOverMask, VOICE_MASKING_MARGIN_DB } from "./loudness.js";
import { mixdown, resolveClipBaseGain } from "./mixdown.js";
import type { AudioTimeline } from "./timeline.js";

// Verdict thresholds for the overall level, in proper R128 units (see ebur128.ts). Loosely
// modelled on short-form/streaming delivery: platforms normalise to around -14 LUFS, and a
// -1 dBTP ceiling keeps the lossy encode from clipping.
export const TRUE_PEAK_CEILING_DBTP = -1;
export const TOO_QUIET_LUFS = -24;
export const TOO_LOUD_LUFS = -9;

export interface MixHealthReport {
  /** Copied from the R128 measurement the report was built from, for convenience. */
  integratedLufs: number;
  truePeakDbtp: number;
  overCeiling: boolean;
  tooQuiet: boolean;
  tooLoud: boolean;
  /** Only present when the timeline has both a voice clip and a music/sfx clip, so there's
   * something to compare. Null otherwise — the UI should just not show that part of the report. */
  balance: {
    voiceDb: number;
    backingUnderVoiceDb: number;
    maskingRisk: boolean;
  } | null;
  /** Plain-language verdicts, ready to render as-is. */
  messages: Array<{ level: "warn" | "info"; text: string }>;
}

function fmt(db: number): string {
  return Number.isFinite(db) ? `${db.toFixed(1)} dB` : "—";
}

// `loudness` is the R128 measurement of the full mix (see measureLoudness.ts) — passed in rather
// than re-measured here, since the caller already has it for the loudness meter.
export async function analyzeMixHealth(timeline: AudioTimeline, loudness: LoudnessMeasurement): Promise<MixHealthReport> {
  const { integratedLufs, truePeakDbtp } = loudness;
  const overCeiling = truePeakDbtp > TRUE_PEAK_CEILING_DBTP;
  const tooQuiet = Number.isFinite(integratedLufs) && integratedLufs <= TOO_QUIET_LUFS;
  const tooLoud = integratedLufs >= TOO_LOUD_LUFS;

  const messages: MixHealthReport["messages"] = [];
  if (overCeiling) {
    messages.push({
      level: "warn",
      text: `True peak ${truePeakDbtp.toFixed(1)} dBTP is over the ${TRUE_PEAK_CEILING_DBTP} dBTP ceiling — it can clip once encoded to MP3/AAC. Pull down the loudest clip(s).`,
    });
  }
  if (tooQuiet) {
    messages.push({
      level: "warn",
      text: `Mix is quiet overall (${integratedLufs.toFixed(1)} LUFS) — platforms won't turn it up, so it'll sound weak next to other content.`,
    });
  } else if (tooLoud) {
    messages.push({
      level: "warn",
      text: `Mix is hot overall (${integratedLufs.toFixed(1)} LUFS) — it'll be turned down on upload; consider lowering clips a few dB instead.`,
    });
  }

  const hasVoice = timeline.clips.some((c) => c.role === "voice" && !c.muted && c.trimEndSec > c.trimStartSec);
  const hasBacking = timeline.clips.some((c) => c.role !== "voice" && !c.muted && c.trimEndSec > c.trimStartSec);

  let balance: MixHealthReport["balance"] = null;
  if (hasVoice && hasBacking) {
    const activity = buildVoiceActivity(timeline, (clip, source) => resolveClipBaseGain(clip, source.buffer));
    const { active } = buildDuckCurve(activity, timeline.ducking);
    const speakingFrames = active.reduce((n, v) => n + v, 0);

    if (speakingFrames > 0) {
      const [voiceBuf, backingBuf] = await Promise.all([
        mixdown(timeline, { clipFilter: (c) => c.role === "voice" }),
        mixdown(timeline, { clipFilter: (c) => c.role !== "voice" }),
      ]);
      const voiceDb = computeLoudnessOverMask(voiceBuf, activity.frameSec, active);
      const backingUnderVoiceDb = computeLoudnessOverMask(backingBuf, activity.frameSec, active);
      // Positive = backing sits safely under the voice by this many dB; negative = backing is
      // actually louder than the voice while it's speaking.
      const headroomDb = voiceDb - backingUnderVoiceDb;
      const maskingRisk = headroomDb < VOICE_MASKING_MARGIN_DB;
      balance = { voiceDb, backingUnderVoiceDb, maskingRisk };

      if (maskingRisk) {
        const relation = headroomDb >= 0 ? `only ~${fmt(headroomDb)} under` : `~${fmt(Math.abs(headroomDb))} LOUDER than`;
        messages.push({
          level: "warn",
          text: timeline.ducking.enabled
            ? `Even with auto-ducking on, music/SFX are ${relation} your voice-over while it's speaking — raise the max duck amount${timeline.ducking.adaptive ? ' or the "keep under" margin' : ""}.`
            : `Music/SFX are ${relation} your voice-over while it's speaking — it's likely masking it. Turn on Auto-ducking.`,
        });
      } else if (timeline.ducking.enabled) {
        messages.push({ level: "info", text: `Auto-ducking is keeping music/SFX ~${fmt(headroomDb)} under your voice-over.` });
      }
    }
  }

  if (messages.length === 0) messages.push({ level: "info", text: "Levels look healthy." });

  return { integratedLufs, truePeakDbtp, overCeiling, tooQuiet, tooLoud, balance, messages };
}
