import { useMemo, useState } from "react";
import { SliderField } from "../imageEditor/SliderField.js";
import { TimeField } from "./TimeField.js";
import { computePeakAmplitude, detectSilenceBounds } from "./waveform.js";
import { gainToDb, LOUDNESS_NORMALIZE_TARGET_DB, NORMALIZE_PEAK_TARGET_DBFS } from "./dbUtils.js";
import { computeIntegratedLoudnessDb } from "./loudness.js";
import { AUDIO_CLIP_ROLES, clipVisibleDuration, MIN_CLIP_SEC, type AudioClip, type AudioSource, type NormalizeMode } from "./timeline.js";

interface ClipInspectorProps {
  clip: AudioClip;
  source: AudioSource;
  /** This clip's 1-based position among its lane's clips in timeline order — shown so a stack of
   * clips on one lane can be told apart at a glance ("2 of 5") independent of their names. */
  orderIndex: number;
  laneCount: number;
  playheadSec: number;
  onChange: (patch: Partial<AudioClip>) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRippleDelete: () => void;
}

export function ClipInspector({
  clip,
  source,
  orderIndex,
  laneCount,
  playheadSec,
  onChange,
  onSplit,
  onDuplicate,
  onDelete,
  onRippleDelete,
}: ClipInspectorProps) {
  const [silenceThresholdDb, setSilenceThresholdDb] = useState(-45);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const dur = source.buffer.duration;
  const region = clip.trimEndSec - clip.trimStartSec;
  const visible = clipVisibleDuration(clip);
  const canSplit = playheadSec > clip.startSec + MIN_CLIP_SEC && playheadSec < clip.startSec + visible - MIN_CLIP_SEC;

  const resolvedNormalizeDb = useMemo(() => {
    if (clip.normalizeMode === "loudness") {
      const loudness = computeIntegratedLoudnessDb(source.buffer, clip.trimStartSec, clip.trimEndSec);
      return LOUDNESS_NORMALIZE_TARGET_DB - loudness;
    }
    const peak = computePeakAmplitude(source.buffer, clip.trimStartSec, clip.trimEndSec);
    return NORMALIZE_PEAK_TARGET_DBFS - gainToDb(peak);
  }, [source.buffer, clip.trimStartSec, clip.trimEndSec, clip.normalizeMode]);

  function trimSilence() {
    const bounds = detectSilenceBounds(source.buffer, silenceThresholdDb);
    onChange({ trimStartSec: bounds.startSec, trimEndSec: Math.max(bounds.startSec + MIN_CLIP_SEC, bounds.endSec) });
  }

  return (
    <section className="ie-section ae-inspector">
      <h3>
        Clip {orderIndex} — {source.name}
      </h3>

      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={nameDraft ?? clip.name}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            if (nameDraft !== null) onChange({ name: nameDraft.trim() || source.name });
            setNameDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setNameDraft(null);
          }}
        />
      </label>

      <div className="inline-fields ae-fields">
        <TimeField label="Start (s)" seconds={clip.startSec} min={0} max={100000} onCommit={(v) => onChange({ startSec: v })} />
        <label className="field">
          <span>Lane</span>
          <select value={clip.laneIndex} onChange={(e) => onChange({ laneIndex: Number(e.target.value) })}>
            {Array.from({ length: laneCount }, (_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Role</span>
        <select value={clip.role} onChange={(e) => onChange({ role: e.target.value as AudioClip["role"] })}>
          {AUDIO_CLIP_ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        {clip.role === "voice"
          ? "Marked as Voice — Auto-ducking (see the Ducking panel) watches clips marked this way and pulls music/SFX down under them."
          : "Marked as " +
            (clip.role === "sfx" ? "SFX" : "Music") +
            " — Auto-ducking will duck this clip under any Voice clip it overlaps."}
      </p>

      <div className="inline-fields ae-fields">
        <TimeField
          label="Trim start (s)"
          seconds={clip.trimStartSec}
          min={0}
          max={clip.trimEndSec - MIN_CLIP_SEC}
          onCommit={(v) => onChange({ trimStartSec: v })}
        />
        <TimeField
          label="Trim end (s)"
          seconds={clip.trimEndSec}
          min={clip.trimStartSec + MIN_CLIP_SEC}
          max={dur}
          onCommit={(v) => onChange({ trimEndSec: v })}
        />
      </div>

      <div className="inline-fields inline-fields-wrap">
        <button type="button" onClick={trimSilence}>
          Trim silence
        </button>
        <button type="button" onClick={onSplit} disabled={!canSplit} title={canSplit ? "" : "Move the playhead inside this clip"}>
          Split at playhead
        </button>
        <button type="button" onClick={onDuplicate} title="Insert a copy of this clip right after it, same lane">
          Duplicate
        </button>
      </div>
      <SliderField
        label="Silence threshold"
        value={silenceThresholdDb}
        min={-70}
        max={-20}
        step={1}
        onChange={setSilenceThresholdDb}
        format={(v) => `${v} dB`}
      />

      <SliderField
        label="Fade in"
        value={clip.fadeInSec}
        min={0}
        max={Math.max(0.1, region / 2)}
        step={0.1}
        onChange={(v) => onChange({ fadeInSec: v })}
        format={(v) => `${v.toFixed(1)} s`}
      />
      <SliderField
        label="Fade out"
        value={clip.fadeOutSec}
        min={0}
        max={Math.max(0.1, region / 2)}
        step={0.1}
        onChange={(v) => onChange({ fadeOutSec: v })}
        format={(v) => `${v.toFixed(1)} s`}
      />

      <div className="field">
        <span>Normalize</span>
        <div className="inline-fields inline-fields-wrap">
          {(
            [
              { id: "off", label: "Off" },
              { id: "peak", label: `Peak (${NORMALIZE_PEAK_TARGET_DBFS} dBFS)` },
              { id: "loudness", label: `Loudness (~${LOUDNESS_NORMALIZE_TARGET_DB} dB)` },
            ] as Array<{ id: NormalizeMode; label: string }>
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              className={clip.normalizeMode === m.id ? "active" : ""}
              onClick={() => onChange({ normalizeMode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">
        {clip.normalizeMode === "peak" &&
          "Peak normalize only looks at the single loudest sample — two clips normalized this way can still sound very different in practice (e.g. a squashed music bed vs. a dynamic voice take). Loudness normalize targets the average level instead, which tracks how loud it actually sounds."}
        {clip.normalizeMode === "loudness" &&
          "Loudness normalize targets this clip's average level — a better match to how loud it actually sounds than a peak reading."}
        {clip.normalizeMode === "off" && "No automatic gain — only the Gain slider below applies."}
      </p>
      <SliderField
        label="Gain"
        value={clip.gainDb}
        min={-30}
        max={30}
        step={0.5}
        onChange={(v) => onChange({ gainDb: v })}
        format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`}
      />
      {clip.normalizeMode !== "off" && <p className="hint">Normalize on — resolved gain: {resolvedNormalizeDb.toFixed(1)} dB</p>}

      <SliderField
        label="Speed"
        value={clip.speed}
        min={0.5}
        max={2}
        step={0.05}
        onChange={(v) => onChange({ speed: v })}
        format={(v) => `${v.toFixed(2)}×`}
      />

      <label className="ae-check">
        <input type="checkbox" checked={clip.muted} onChange={(e) => onChange({ muted: e.target.checked })} />
        <span>Mute clip</span>
      </label>

      <div className="inline-fields inline-fields-wrap">
        <button type="button" className="ae-danger" onClick={onDelete}>
          Delete clip
        </button>
        <button
          type="button"
          className="ae-danger"
          onClick={onRippleDelete}
          title="Delete this clip and shift everything after it left, across all lanes"
        >
          Ripple delete
        </button>
      </div>
    </section>
  );
}
