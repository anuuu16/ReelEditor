import { useMemo, useState } from "react";
import { SliderField } from "../imageEditor/SliderField.js";
import { TimeField } from "./TimeField.js";
import { computePeakAmplitude, detectSilenceBounds } from "./waveform.js";
import { NORMALIZE_TARGET_DBFS } from "./mixdown.js";
import { clipVisibleDuration, MIN_CLIP_SEC, type AudioClip, type AudioSource } from "./timeline.js";

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

function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(gain, 1e-6));
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
    const peak = computePeakAmplitude(source.buffer, clip.trimStartSec, clip.trimEndSec);
    return NORMALIZE_TARGET_DBFS - gainToDb(peak);
  }, [source.buffer, clip.trimStartSec, clip.trimEndSec]);

  function trimSilence() {
    const bounds = detectSilenceBounds(source.buffer, silenceThresholdDb);
    onChange({ trimStartSec: bounds.startSec, trimEndSec: Math.max(bounds.startSec + MIN_CLIP_SEC, bounds.endSec) });
  }

  return (
    <section className="ie-section ae-inspector">
      <h3>Clip {orderIndex} — {source.name}</h3>

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
        <TimeField
          label="Start (s)"
          seconds={clip.startSec}
          min={0}
          max={100000}
          onCommit={(v) => onChange({ startSec: v })}
        />
        <label className="field">
          <span>Lane</span>
          <select
            value={clip.laneIndex}
            onChange={(e) => onChange({ laneIndex: Number(e.target.value) })}
          >
            {Array.from({ length: laneCount }, (_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
      </div>

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

      <label className="ae-check">
        <input type="checkbox" checked={clip.normalize} onChange={(e) => onChange({ normalize: e.target.checked })} />
        <span>Normalize to {NORMALIZE_TARGET_DBFS} dBFS</span>
      </label>
      <SliderField
        label="Gain"
        value={clip.gainDb}
        min={-30}
        max={30}
        step={0.5}
        onChange={(v) => onChange({ gainDb: v })}
        format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`}
      />
      {clip.normalize && <p className="hint">Normalize on — resolved gain: {resolvedNormalizeDb.toFixed(1)} dB</p>}

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
        <button type="button" className="ae-danger" onClick={onRippleDelete} title="Delete this clip and shift everything after it left, across all lanes">
          Ripple delete
        </button>
      </div>
    </section>
  );
}
