import type { MixHealthReport } from "./mixHealth.js";

interface MixHealthPanelProps {
  report: MixHealthReport | null;
  busy: boolean;
  hasClips: boolean;
}

// A meter bar clamped to [-48, 0] dBFS — wide enough to show anything from near-silence to
// clipping without the healthy middle of the range getting squeezed into a sliver.
const METER_MIN_DB = -48;
const METER_MAX_DB = 0;

function meterPct(db: number): number {
  const clamped = Math.max(METER_MIN_DB, Math.min(METER_MAX_DB, db));
  return ((clamped - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)) * 100;
}

function Meter({ label, db, warn }: { label: string; db: number; warn: boolean }) {
  return (
    <div className="ae-meter">
      <div className="ae-meter-row">
        <span>{label}</span>
        <span className={warn ? "ae-meter-value warn" : "ae-meter-value"}>{Number.isFinite(db) ? `${db.toFixed(1)} dB` : "—"}</span>
      </div>
      <div className="ae-meter-track">
        <div className={warn ? "ae-meter-fill warn" : "ae-meter-fill"} style={{ width: `${meterPct(db)}%` }} />
      </div>
    </div>
  );
}

// Plain-language verdicts on the mix: overall level (from the R128 loudness meter under the
// timeline) and whether the voice-over is going to be audible over the music — the thing
// "Normalize" alone never answered, since it only ever looks at one clip's peak in isolation.
export function MixHealthPanel({ report, busy, hasClips }: MixHealthPanelProps) {
  if (!hasClips) return null;
  return (
    <section className="ie-section ae-mix-health">
      <h3>Mix health{busy ? " …" : ""}</h3>
      {!report && <p className="hint">Analyzing…</p>}
      {report && (
        <>
          {report.balance && (
            <>
              <Meter label="Voice (while speaking)" db={report.balance.voiceDb} warn={false} />
              <Meter label="Music/SFX under voice" db={report.balance.backingUnderVoiceDb} warn={report.balance.maskingRisk} />
            </>
          )}
          <ul className="ae-mix-health-messages">
            {report.messages.map((m, i) => (
              <li key={i} className={m.level === "warn" ? "warn" : "info"}>
                {m.level === "warn" ? "⚠" : "✓"} {m.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
