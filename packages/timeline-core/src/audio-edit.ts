// The edit a standalone audio-editor session produces: a kept region of the source plus a handful
// of linear transforms on it. It is the contract between the in-browser Web Audio preview and the
// server-side ffmpeg encode — both read this one shape so "what you hear" matches "what you export".
// Every field is a resolved number (Normalize, for instance, is collapsed to a fixed `gainDb` by
// the client before it lands here); nothing here needs the source file to interpret.
export interface AudioEditSpec {
  /** Seconds into the source where the kept region begins. */
  trimStartSec: number;
  /** Seconds into the source where the kept region ends (must be > trimStartSec). */
  trimEndSec: number;
  /** Linear fade-in ramp at the start of the kept region, in source seconds. */
  fadeInSec: number;
  /** Linear fade-out ramp at the end of the kept region, in source seconds. */
  fadeOutSec: number;
  /** Gain applied across the whole region, decibels (0 = unchanged). Folds in any normalization. */
  gainDb: number;
  /** Playback-speed multiplier (1 = unchanged). Shifts pitch, exactly like ffmpeg's atempo. */
  speed: number;
}

export const NEUTRAL_AUDIO_EDIT_SPEC: Omit<AudioEditSpec, "trimStartSec" | "trimEndSec"> = {
  fadeInSec: 0,
  fadeOutSec: 0,
  gainDb: 0,
  speed: 1,
};

// atempo only accepts 0.5–2.0 per instance, so a larger/smaller factor is reached by stacking
// several. Returns the individual `atempo=<f>` filter terms (empty when speed is 1).
export function buildAtempoFilters(speed: number): string[] {
  if (!Number.isFinite(speed) || speed === 1 || speed <= 0) return [];
  const factors: number[] = [];
  let remaining = speed;
  while (remaining > 2.0) {
    factors.push(2.0);
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(remaining);
  return factors.map((f) => `atempo=${f.toFixed(4)}`);
}

function clampSpec(spec: AudioEditSpec): AudioEditSpec {
  const trimStartSec = Math.max(0, spec.trimStartSec);
  const trimEndSec = Math.max(trimStartSec + 0.01, spec.trimEndSec);
  const regionDur = trimEndSec - trimStartSec;
  return {
    trimStartSec,
    trimEndSec,
    fadeInSec: Math.min(Math.max(spec.fadeInSec, 0), regionDur / 2),
    fadeOutSec: Math.min(Math.max(spec.fadeOutSec, 0), regionDur / 2),
    gainDb: Number.isFinite(spec.gainDb) ? spec.gainDb : 0,
    speed: Number.isFinite(spec.speed) && spec.speed > 0 ? spec.speed : 1,
  };
}

// The `-af` filter chain for the edit, ordered so every ramp is expressed in *source* seconds:
// fades first (before atempo time-scales them), then gain, then speed. Empty string when the edit
// is just a trim with no transforms.
export function buildAudioEditFilter(spec: AudioEditSpec): string {
  const { fadeInSec, fadeOutSec, gainDb, speed, trimStartSec, trimEndSec } = clampSpec(spec);
  const regionDur = trimEndSec - trimStartSec;
  const parts: string[] = [];
  if (fadeInSec > 0) parts.push(`afade=t=in:st=0:d=${fadeInSec.toFixed(3)}`);
  if (fadeOutSec > 0) parts.push(`afade=t=out:st=${(regionDur - fadeOutSec).toFixed(3)}:d=${fadeOutSec.toFixed(3)}`);
  if (gainDb !== 0) parts.push(`volume=${gainDb.toFixed(2)}dB`);
  parts.push(...buildAtempoFilters(speed));
  return parts.join(",");
}

// The trim, as ffmpeg args to place *before* `-i <input>`. Input-side seek so the kept region is
// isolated first and only then time-scaled/faded — output-side `-ss`/`-to` would instead filter the
// whole file and clip the result, so a sped-up selection would come out the wrong length.
export function buildAudioEditInputArgs(spec: AudioEditSpec): string[] {
  const { trimStartSec, trimEndSec } = clampSpec(spec);
  return ["-ss", trimStartSec.toFixed(3), "-to", trimEndSec.toFixed(3)];
}

// The filter args to place *after* `-i <input>` (empty when the edit is a bare trim). Caller adds
// the codec/bitrate/output args.
export function buildAudioEditFilterArgs(spec: AudioEditSpec): string[] {
  const filter = buildAudioEditFilter(spec);
  return filter ? ["-af", filter] : [];
}
