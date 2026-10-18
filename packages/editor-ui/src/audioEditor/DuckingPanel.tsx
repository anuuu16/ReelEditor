import { SliderField } from "../imageEditor/SliderField.js";
import type { DuckingSettings } from "./timeline.js";

interface DuckingPanelProps {
  ducking: DuckingSettings;
  onChange: (patch: Partial<DuckingSettings>) => void;
}

// Controls for auto-ducking: pulls every "Music"/"SFX" clip down while a "Voice" clip is actually
// speaking (see duck.ts), then eases it back up once it stops. Mark clips' roles in the Clip
// inspector — this panel only has the knobs for *how much*/*how fast*, not *which clips*.
export function DuckingPanel({ ducking, onChange }: DuckingPanelProps) {
  return (
    <section className="ie-section ae-ducking">
      <h3>Auto-ducking</h3>
      <label className="ae-check">
        <input type="checkbox" checked={ducking.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
        <span>Duck music/SFX under voice</span>
      </label>
      <p className="hint">
        Mark your voice-over clip's Role as "Voice-over" (in its Clip inspector) and any backing track as "Music"/"SFX" — with this on,
        backing clips automatically quiet down whenever a Voice clip is actually speaking, and come back up in the gaps. Applies to
        playback, Save, and every export format, so you only set it up once.
      </p>

      {ducking.enabled && (
        <>
          <label className="ae-check">
            <input type="checkbox" checked={ducking.adaptive} onChange={(e) => onChange({ adaptive: e.target.checked })} />
            <span>Only as much as needed</span>
          </label>
          {ducking.adaptive && (
            <SliderField
              label="Keep music under voice by"
              value={ducking.keepUnderDb}
              min={3}
              max={24}
              step={1}
              onChange={(v) => onChange({ keepUnderDb: v })}
              format={(v) => `${v.toFixed(0)} dB`}
            />
          )}
          <SliderField
            label={ducking.adaptive ? "Max duck amount" : "Duck amount"}
            value={ducking.amountDb}
            min={0}
            max={36}
            step={1}
            onChange={(v) => onChange({ amountDb: v })}
            format={(v) => `${v.toFixed(0)} dB`}
          />
          <p className="hint">
            {ducking.adaptive
              ? "Each backing clip is measured against the voice and pulled down only as far as it needs to sit that many dB under it (never more than the max) — music that's already quiet enough isn't touched; a loud bed gets the full amount."
              : "Every backing clip is pulled down by the same fixed amount whenever the voice is speaking, however quiet it already was."}
          </p>
          <SliderField
            label="Voice threshold"
            value={ducking.thresholdDb}
            min={-60}
            max={-10}
            step={1}
            onChange={(v) => onChange({ thresholdDb: v })}
            format={(v) => `${v.toFixed(0)} dBFS`}
          />
          <p className="hint">Lower the threshold if quieter speech isn't triggering the duck; raise it if background hiss is.</p>
          <SliderField
            label="Attack"
            value={ducking.attackSec}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onChange({ attackSec: v })}
            format={(v) => `${v.toFixed(2)} s`}
          />
          <SliderField
            label="Hold"
            value={ducking.holdSec}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => onChange({ holdSec: v })}
            format={(v) => `${v.toFixed(2)} s`}
          />
          <p className="hint">
            Hold keeps the music down through pauses shorter than this (the gaps between words and sentences) so it doesn't bob up and down;
            the release only starts once the voice has been quiet for longer. The duck also starts slightly before each phrase (by the
            attack time), since the mix is rendered ahead of time.
          </p>
          <SliderField
            label="Release"
            value={ducking.releaseSec}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => onChange({ releaseSec: v })}
            format={(v) => `${v.toFixed(2)} s`}
          />
        </>
      )}

      <p className="hint">
        How this works: it's a light client-side approximation of a sidechain compressor — it samples the voice clip's own level, decides
        when it's "speaking", and ramps backing clips' gain down/up around that. For most voiceover-over-music edits that's plenty. A more
        practical approach for heavier use (long-form, music with constantly-varying loudness, or needing broadcast-grade ducking) would be
        rendering it server-side with ffmpeg's <code>sidechaincompress</code> filter, which does true sample-accurate sidechain compression
        — worth moving to if this editor ever needs to duck against the real output levels (e.g. after other plugins/EQ) rather than the
        source clip.
      </p>
    </section>
  );
}
