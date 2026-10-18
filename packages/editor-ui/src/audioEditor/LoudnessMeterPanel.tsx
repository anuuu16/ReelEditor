import type { LoudnessMeasurement } from "./ebur128.js";

interface LoudnessMeterPanelProps {
  measurement: LoudnessMeasurement | null;
  busy: boolean;
  /** Selected reference target (an id from LOUDNESS_TARGETS) — owned by the editor so it persists. */
  targetId: string;
  onTargetChange: (id: string) => void;
}

// Common delivery targets — what the meter's "vs. target" readout compares against. Platforms
// normalise to roughly these, so landing near one means the export won't be turned down (or left
// quiet) on upload.
export const LOUDNESS_TARGETS: Array<{ id: string; label: string; lufs: number; ceilingDbtp: number }> = [
  { id: "social", label: "Social / streaming (−14 LUFS, −1 dBTP)", lufs: -14, ceilingDbtp: -1 },
  { id: "podcast", label: "Podcast / spoken word (−16 LUFS, −1 dBTP)", lufs: -16, ceilingDbtp: -1 },
  { id: "broadcast", label: "Broadcast EBU R128 (−23 LUFS, −1 dBTP)", lufs: -23, ceilingDbtp: -1 },
];

const LUFS_SCALE_MIN = -40;
const LUFS_SCALE_MAX = 0;
const TP_SCALE_MIN = -30;
const TP_SCALE_MAX = 3;

function pct(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((Math.max(min, Math.min(max, value)) - min) / (max - min)) * 100;
}

function fmt(value: number, unit: string, digits = 1): string {
  return Number.isFinite(value) ? `${value.toFixed(digits)} ${unit}` : `−∞ ${unit}`;
}

function signed(value: number, digits = 1): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function ScaleBar({
  value,
  min,
  max,
  marker,
  markerLabel,
  over,
}: {
  value: number;
  min: number;
  max: number;
  marker: number;
  markerLabel: string;
  over: boolean;
}) {
  return (
    <div className="ae-lm-track">
      <div className={`ae-lm-fill${over ? " over" : ""}`} style={{ width: `${pct(value, min, max)}%` }} />
      <div className="ae-lm-marker" style={{ left: `${pct(marker, min, max)}%` }} title={markerLabel} />
    </div>
  );
}

// A full-programme loudness meter (EBU R128 / ITU-R BS.1770) for the whole timeline: integrated
// loudness, true peak, loudness range, plus the momentary/short-term maxima — the same readings
// `ffmpeg -af ebur128=peak=true` prints for the exported file, so the two can be compared directly.
export function LoudnessMeterPanel({ measurement, busy, targetId, onTargetChange }: LoudnessMeterPanelProps) {
  const target = LOUDNESS_TARGETS.find((t) => t.id === targetId) ?? LOUDNESS_TARGETS[0];

  const m = measurement;
  const hasSignal = !!m && Number.isFinite(m.integratedLufs);
  const lufsDelta = hasSignal ? m!.integratedLufs - target.lufs : 0;
  const tpOver = !!m && Number.isFinite(m.truePeakDbtp) && m.truePeakDbtp > target.ceilingDbtp;
  const lufsOff = hasSignal && Math.abs(lufsDelta) > 1;

  return (
    <div className="ae-loudness-meter" aria-label="Loudness meter">
      <div className="ae-lm-header">
        <span className="ae-lm-title">Loudness (EBU R128){busy ? " · measuring…" : ""}</span>
        <select className="ae-lm-target" value={targetId} onChange={(e) => onTargetChange(e.target.value)} title="Reference target">
          {LOUDNESS_TARGETS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="ae-lm-grid">
        <div className="ae-lm-cell ae-lm-primary">
          <span className="ae-lm-label">Integrated</span>
          <span className={`ae-lm-value${lufsOff ? " warn" : ""}`}>{m ? fmt(m.integratedLufs, "LUFS") : "—"}</span>
          <ScaleBar
            value={m?.integratedLufs ?? -Infinity}
            min={LUFS_SCALE_MIN}
            max={LUFS_SCALE_MAX}
            marker={target.lufs}
            markerLabel={`Target ${target.lufs} LUFS`}
            over={lufsOff}
          />
          <span className="ae-lm-sub">{hasSignal ? `${signed(lufsDelta)} LU vs. ${target.lufs} LUFS target` : m ? "silence" : ""}</span>
        </div>

        <div className="ae-lm-cell ae-lm-primary">
          <span className="ae-lm-label">True peak</span>
          <span className={`ae-lm-value${tpOver ? " warn" : ""}`}>{m ? fmt(m.truePeakDbtp, "dBTP") : "—"}</span>
          <ScaleBar
            value={m?.truePeakDbtp ?? -Infinity}
            min={TP_SCALE_MIN}
            max={TP_SCALE_MAX}
            marker={target.ceilingDbtp}
            markerLabel={`Ceiling ${target.ceilingDbtp} dBTP`}
            over={tpOver}
          />
          <span className="ae-lm-sub">
            {m && Number.isFinite(m.truePeakDbtp)
              ? tpOver
                ? `over the ${target.ceilingDbtp} dBTP ceiling — may clip after encoding`
                : `sample peak ${fmt(m.samplePeakDbfs, "dBFS")}`
              : ""}
          </span>
        </div>

        <div className="ae-lm-cell">
          <span className="ae-lm-label">Range (LRA)</span>
          <span className="ae-lm-value small">{m ? fmt(m.loudnessRangeLu, "LU") : "—"}</span>
        </div>
        <div className="ae-lm-cell">
          <span className="ae-lm-label">Short-term max</span>
          <span className="ae-lm-value small">{m ? fmt(m.shortTermMaxLufs, "LUFS") : "—"}</span>
        </div>
        <div className="ae-lm-cell">
          <span className="ae-lm-label">Momentary max</span>
          <span className="ae-lm-value small">{m ? fmt(m.momentaryMaxLufs, "LUFS") : "—"}</span>
        </div>
      </div>
    </div>
  );
}
