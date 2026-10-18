import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SliderField } from "./imageEditor/SliderField.js";
import {
  deleteAudioMediaBlob,
  loadAudioMediaBlob,
  loadAudioProject,
  saveAudioMediaBlob,
  saveAudioProject,
  saveAudioToGallery,
} from "./persistence/db.js";
import { decodeAudioFile } from "./audioEditor/decodeAudio.js";
import { audioBufferToWav } from "./audioEditor/audioBufferToWav.js";
import { computeDuckCurves, mixdown } from "./audioEditor/mixdown.js";
import { analyzeMixHealth, type MixHealthReport } from "./audioEditor/mixHealth.js";
import { measureLoudness, type LoudnessMeasurement } from "./audioEditor/measureLoudness.js";
import { EXPORT_TRUE_PEAK_CEILING_DBTP, makePeakSafe } from "./audioEditor/truePeakSafety.js";
import { loadPrefs, savePrefs } from "./audioEditor/prefs.js";
import { AUDIO_FORMATS, encodeAudio, identitySpec, type AudioExportFormat } from "./audioEditor/api.js";
import { AudioTimeline } from "./audioEditor/AudioTimeline.js";
import { ClipInspector } from "./audioEditor/ClipInspector.js";
import { DuckingPanel } from "./audioEditor/DuckingPanel.js";
import { LoudnessMeterPanel } from "./audioEditor/LoudnessMeterPanel.js";
import { MixHealthPanel } from "./audioEditor/MixHealthPanel.js";
import { useAudioTimelineHistory } from "./audioEditor/useAudioTimelineHistory.js";
import {
  clipEnd,
  clipVisibleDuration,
  closeTimelineGap,
  DEFAULT_DUCKING,
  DEFAULT_LANE_COUNT,
  makeClip,
  migrateClip,
  migrateDucking,
  MIN_PX_PER_SEC,
  MAX_PX_PER_SEC,
  rippleDeleteClip,
  SOURCE_DRAG_TYPE,
  splitClipAt,
  timelineDuration,
  type AudioClip,
  type AudioSource,
  type AudioTimeline as AudioTimelineModel,
  type DuckingSettings,
  type Gap,
  type TimelineNote,
} from "./audioEditor/timeline.js";

interface AudioEditorProps {
  onBack: () => void;
}

const EMPTY: AudioTimelineModel = { sources: [], clips: [], notes: [], laneCount: DEFAULT_LANE_COUNT, ducking: DEFAULT_DUCKING };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ie-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

export function AudioEditor({ onBack }: AudioEditorProps) {
  const { timeline, commit, checkpoint, live, load, undo, redo, canUndo, canRedo } = useAudioTimelineHistory(EMPTY);
  const [projectLoaded, setProjectLoaded] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedGap, setSelectedGap] = useState<Gap | null>(null);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [pxPerSec, setPxPerSec] = useState(80);
  // UI preferences (meter target, export choices) — restored from localStorage so a reload
  // doesn't reset them; the timeline itself is restored from IndexedDB further down.
  const [prefs] = useState(() => loadPrefs());
  const [format, setFormat] = useState<AudioExportFormat>(prefs.exportFormat);
  const [bitrateKbps, setBitrateKbps] = useState(prefs.bitrateKbps);
  const [peakSafeExport, setPeakSafeExport] = useState(prefs.peakSafeExport);
  const [loudnessTargetId, setLoudnessTargetId] = useState(prefs.loudnessTargetId);
  useEffect(() => {
    savePrefs({ loudnessTargetId, exportFormat: format, bitrateKbps, peakSafeExport });
  }, [loudnessTargetId, format, bitrateKbps, peakSafeExport]);

  const [mixBuffer, setMixBuffer] = useState<AudioBuffer | null>(null);
  const [loudness, setLoudness] = useState<LoudnessMeasurement | null>(null);
  const [mixHealth, setMixHealth] = useState<MixHealthReport | null>(null);
  const [mixHealthBusy, setMixHealthBusy] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartRef = useRef<{ ctxTime: number; from: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  const totalDur = timelineDuration(timeline);
  // Per-clip ducking curves, drawn onto the backing clips' waveforms (same curves mixdown applies).
  const duckCurves = useMemo(() => computeDuckCurves(timeline), [timeline]);
  const selectedClip = timeline.clips.find((c) => c.id === selectedClipId) ?? null;
  const selectedSource = selectedClip ? (timeline.sources.find((s) => s.id === selectedClip.sourceId) ?? null) : null;
  const selectedOrderIndex = selectedClip
    ? timeline.clips
        .filter((c) => c.laneIndex === selectedClip.laneIndex)
        .sort((a, b) => a.startSec - b.startSec)
        .findIndex((c) => c.id === selectedClip.id) + 1
    : 0;

  const flash = useCallback((message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 2600);
  }, []);

  const stopPlayback = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (nodeRef.current) {
      nodeRef.current.onended = null;
      try {
        nodeRef.current.stop();
      } catch {
        /* already stopped */
      }
      nodeRef.current = null;
    }
    playStartRef.current = null;
    setIsPlaying(false);
  }, []);

  // One "dirty" flag so a continuous gesture (slider drag, clip drag) = one undo step: the first
  // change checkpoints, the window-wide pointerup/keyup clears it.
  const beginEdit = useCallback(() => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    checkpoint();
  }, [checkpoint]);

  useEffect(() => {
    const clear = () => {
      dirtyRef.current = false;
    };
    window.addEventListener("pointerup", clear);
    window.addEventListener("keyup", clear);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("keyup", clear);
    };
  }, []);

  useEffect(() => {
    return () => {
      stopPlayback();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [stopPlayback]);

  // Debounced re-mix for preview whenever the timeline changes.
  useEffect(() => {
    if (timeline.clips.length === 0) {
      setMixBuffer(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      mixdown(timeline)
        .then((buf) => {
          if (!cancelled) setMixBuffer(buf);
        })
        .catch((err) => console.error("Mixdown failed", err));
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [timeline]);

  // Measures the rendered mix (EBU R128 loudness + true peak, in a Worker) whenever the preview
  // buffer changes, then derives the mix-health verdicts from it — piggybacking on the mixdown
  // debounce above rather than adding its own, so it never analyzes a buffer that's already stale.
  useEffect(() => {
    if (!mixBuffer) {
      setLoudness(null);
      setMixHealth(null);
      return;
    }
    let cancelled = false;
    setMixHealthBusy(true);
    measureLoudness(mixBuffer)
      .then(async (measurement) => {
        if (cancelled) return;
        setLoudness(measurement);
        const report = await analyzeMixHealth(timeline, measurement);
        if (!cancelled) setMixHealth(report);
      })
      .catch((err) => console.error("Mix analysis failed", err))
      .finally(() => {
        if (!cancelled) setMixHealthBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixBuffer]);

  // Any timeline edit stops playback (the mixed buffer is now stale) and drops a selected gap —
  // clips may have moved, so its bounds could no longer point at an actual empty stretch.
  useEffect(() => {
    stopPlayback();
    setSelectedGap(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

  // Restores the previously-persisted audio project (if any) on mount — without this, refreshing
  // the page silently discards whatever was being worked on.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const persisted = await loadAudioProject().catch(() => null);
      // A cancelled instance (React StrictMode double-invokes this effect in dev, or the component
      // unmounted) must do NOTHING more — critically, must not flip projectLoaded, which would let
      // the autosave effect below fire against the still-EMPTY starting timeline and overwrite the
      // real persisted project before the other (non-cancelled) instance finishes restoring it.
      if (cancelled) return;
      if (!persisted) {
        setProjectLoaded(true);
        return;
      }
      const sources: AudioSource[] = [];
      for (const meta of persisted.sourceMeta) {
        const blob = await loadAudioMediaBlob(meta.id).catch(() => null);
        if (!blob) continue; // its file is gone from storage — any clips referencing it are dropped below
        try {
          sources.push({ id: meta.id, name: meta.name, buffer: await decodeAudioFile(blob) });
        } catch {
          /* unreadable — skip this source */
        }
      }
      if (cancelled) return;
      const validIds = new Set(sources.map((s) => s.id));
      load({
        sources,
        clips: persisted.clips.filter((c) => validIds.has(c.sourceId)).map(migrateClip),
        notes: persisted.notes ?? [],
        laneCount: persisted.laneCount,
        ducking: migrateDucking(persisted.ducking),
      });
      setProjectLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosaves (debounced) on every change, once the restore above has finished — otherwise this
  // would immediately overwrite the persisted project with the blank starting state while the real
  // one is still loading.
  useEffect(() => {
    if (!projectLoaded) return;
    const handle = window.setTimeout(() => {
      void saveAudioProject({
        sourceMeta: timeline.sources.map((s) => ({ id: s.id, name: s.name })),
        clips: timeline.clips,
        notes: timeline.notes,
        laneCount: timeline.laneCount,
        ducking: timeline.ducking,
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [timeline, projectLoaded]);

  function selectClip(id: string | null) {
    setSelectedClipId(id);
    setSelectedGap(null);
  }

  function selectGap(gap: Gap | null) {
    setSelectedGap(gap);
    setSelectedClipId(null);
  }

  const addFiles = useCallback(
    async (files: File[], laneIndex?: number, startSec?: number) => {
      const decoded: Array<{ source: AudioSource; file: File }> = [];
      for (const file of files) {
        try {
          const buffer = await decodeAudioFile(file);
          decoded.push({
            source: { id: crypto.randomUUID(), name: file.name.replace(/\.[^./]+$/, "") || "audio", buffer },
            file,
          });
        } catch (err) {
          console.error("decode failed", err);
          flash(`Couldn't read ${file.name}`);
        }
      }
      if (decoded.length === 0) return;
      // Persisted immediately, while the original file is still on hand — by autosave time only
      // the decoded AudioBuffer remains in state, which isn't what gets re-decoded on reload.
      for (const { source, file } of decoded) void saveAudioMediaBlob(source.id, file);
      commit((t) => {
        const sources = [...t.sources, ...decoded.map((d) => d.source)];
        let cursor = startSec ?? t.clips.filter((c) => c.laneIndex === 0).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
        const clips = [...t.clips];
        for (const { source } of decoded) {
          const clip = makeClip(source, laneIndex ?? 0, cursor);
          clips.push(clip);
          cursor += clipVisibleDuration(clip);
        }
        return { ...t, sources, clips };
      });
    },
    [commit, flash],
  );

  function updateClip(id: string, patch: Partial<AudioClip>, opts?: { continuous?: boolean }) {
    if (opts?.continuous) {
      beginEdit();
      live((t) => ({ ...t, clips: t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    } else {
      // Coalesced per clip+field: dragging the inspector's Gain slider (or spinning Fade in, etc.)
      // becomes ONE undo entry for the whole adjustment, not one per slider tick.
      commit(
        (t) => ({ ...t, clips: t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),
        `clip:${id}:${Object.keys(patch).join(",")}`,
      );
    }
  }

  function deleteClip(id: string) {
    commit((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== id) }));
    if (selectedClipId === id) setSelectedClipId(null);
  }

  // Inserts a copy of `id` immediately after it, same lane — a quick way to repeat a clip without
  // re-importing or re-dragging it from Sources.
  function duplicateClip(id: string) {
    const clip = timeline.clips.find((c) => c.id === id);
    if (!clip) return;
    const copy: AudioClip = { ...clip, id: crypto.randomUUID(), startSec: clipEnd(clip) };
    commit((t) => ({ ...t, clips: [...t.clips, copy] }));
    setSelectedClipId(copy.id);
  }

  // Removes a source AND every clip built from it — an orphaned clip has nothing to play or draw.
  function removeSource(sourceId: string) {
    void deleteAudioMediaBlob(sourceId);
    commit((t) => ({
      ...t,
      sources: t.sources.filter((s) => s.id !== sourceId),
      clips: t.clips.filter((c) => c.sourceId !== sourceId),
    }));
    if (selectedClip?.sourceId === sourceId) setSelectedClipId(null);
  }

  function dropExistingSource(sourceId: string, laneIndex: number, startSec: number) {
    commit((t) => {
      const source = t.sources.find((s) => s.id === sourceId);
      if (!source) return t;
      return { ...t, clips: [...t.clips, makeClip(source, laneIndex, startSec)] };
    });
  }

  // Deletes the clip AND closes the hole it leaves behind (every lane shifts left) — for cutting
  // an unwanted clip out of the middle of a track without leaving a gap in its place.
  function rippleDelete(id: string) {
    commit((t) => rippleDeleteClip(t, id));
    if (selectedClipId === id) setSelectedClipId(null);
  }

  // Cuts the selected empty stretch out of the whole timeline, shifting every clip after it left —
  // e.g. an AI-extended music track with a silent gap in the middle: select the gap, close it.
  function closeSelectedGap() {
    if (!selectedGap) return;
    commit((t) => closeTimelineGap(t, selectedGap));
  }

  function addNoteAtPlayhead() {
    const note: TimelineNote = { id: crypto.randomUUID(), atSec: playheadSec, text: "" };
    commit((t) => ({ ...t, notes: [...t.notes, note] }));
    setOpenNoteId(note.id);
  }

  function updateNoteText(id: string, text: string) {
    // Coalesced per note: typing a sentence is one undo entry, not one per keystroke.
    commit((t) => ({ ...t, notes: t.notes.map((n) => (n.id === id ? { ...n, text } : n)) }), `note:${id}`);
  }

  function deleteNote(id: string) {
    commit((t) => ({ ...t, notes: t.notes.filter((n) => n.id !== id) }));
    if (openNoteId === id) setOpenNoteId(null);
  }

  // Splits whichever clip `id` names at the current playhead — used both by the inspector's
  // "Split at playhead" (always the selected clip) and the clip's own quick-action menu (whichever
  // clip that menu belongs to, selected or not).
  function splitClip(id: string) {
    const clip = timeline.clips.find((c) => c.id === id);
    if (!clip) return;
    const parts = splitClipAt(clip, playheadSec);
    if (!parts) {
      flash("Move the playhead inside the clip first");
      return;
    }
    commit((t) => ({ ...t, clips: t.clips.flatMap((c) => (c.id === id ? parts : [c])) }));
    setSelectedClipId(parts[0].id);
  }

  function updateDucking(patch: Partial<DuckingSettings>) {
    // Coalesced per setting, same as clip fields — one undo per slider adjustment.
    commit((t) => ({ ...t, ducking: { ...t.ducking, ...patch } }), `ducking:${Object.keys(patch).join(",")}`);
  }

  function setLaneCount(n: number) {
    const next = Math.max(1, Math.min(8, n));
    commit(
      (t) => ({
        ...t,
        laneCount: next,
        clips: t.clips.map((c) => (c.laneIndex >= next ? { ...c, laneIndex: next - 1 } : c)),
      }),
      "laneCount",
    );
  }

  // --- keyboard ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inputType = tag === "INPUT" ? (target as HTMLInputElement).type : null;
      // Text-entry fields own their keystrokes entirely (including the browser's native text
      // undo). Non-text controls — sliders, checkboxes — keep focus after you use them, and
      // must NOT swallow Cmd/Ctrl+Z: "drag a slider, hit undo" has to work.
      const isTextEntry =
        tag === "TEXTAREA" ||
        (tag === "INPUT" && inputType !== "range" && inputType !== "checkbox" && inputType !== "radio" && inputType !== "button");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (isTextEntry) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedClipId) {
          e.preventDefault();
          deleteClip(selectedClipId);
        }
      } else if (e.key === " ") {
        e.preventDefault();
        if (isPlaying) stopPlayback();
        else play();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, selectedClipId, isPlaying, mixBuffer, playheadSec]);

  function play() {
    if (!mixBuffer) return;
    stopPlayback();
    const ctx = (audioCtxRef.current ??= new (
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )());
    void ctx.resume();
    const from = Math.min(Math.max(0, playheadSec), Math.max(0, mixBuffer.duration - 0.01));
    const node = ctx.createBufferSource();
    node.buffer = mixBuffer;
    node.connect(ctx.destination);
    node.onended = () => {
      if (nodeRef.current === node) {
        stopPlayback();
        setPlayheadSec(0);
      }
    };
    node.start(0, from);
    nodeRef.current = node;
    playStartRef.current = { ctxTime: ctx.currentTime, from };
    setIsPlaying(true);
    const tick = () => {
      const st = playStartRef.current;
      if (!st || !audioCtxRef.current) return;
      setPlayheadSec(st.from + (audioCtxRef.current.currentTime - st.ctxTime));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // The rendered mix, optionally trimmed to the -1 dBTP export ceiling — see truePeakSafety.ts for
  // why un-trimmed exports either hard-clip (WAV's 16-bit clamp) or overshoot full scale after a
  // lossy encode (MP3/AAC/Opus reconstruction). A plain static trim, so the mix balance (and the
  // ducking already baked into it) is untouched; quiet mixes pass through unchanged.
  async function renderForExport(): Promise<{ buffer: AudioBuffer; trimDb: number }> {
    const buffer = await mixdown(timeline);
    if (!peakSafeExport) return { buffer, trimDb: 0 };
    const safe = makePeakSafe(buffer);
    return { buffer: safe.buffer, trimDb: safe.trimDb };
  }

  function trimNote(trimDb: number): string {
    return trimDb > 0 ? ` — trimmed ${trimDb.toFixed(1)} dB to the ${EXPORT_TRUE_PEAK_CEILING_DBTP} dBTP ceiling` : "";
  }

  async function encodeCurrentMix(): Promise<{ blob: Blob; ext: string; durationSec: number; trimDb: number } | null> {
    if (timeline.clips.length === 0) {
      flash("Add some audio first");
      return null;
    }
    const { buffer, trimDb } = await renderForExport();
    const wav = audioBufferToWav(buffer);
    const fmt = AUDIO_FORMATS.find((f) => f.id === format);
    if (format === "wav") return { blob: wav, ext: "wav", durationSec: buffer.duration, trimDb };
    const blob = await encodeAudio({
      file: wav,
      spec: identitySpec(buffer.duration),
      format,
      bitrateKbps,
      name: "mix",
    });
    return { blob, ext: fmt?.ext ?? "mp3", durationSec: buffer.duration, trimDb };
  }

  async function handleExport() {
    setIsBusy(true);
    try {
      const result = await encodeCurrentMix();
      if (result) {
        downloadBlob(result.blob, `mix.${result.ext}`);
        flash(`Exported${trimNote(result.trimDb)}`);
      }
    } catch (err) {
      flash(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSave() {
    setIsBusy(true);
    try {
      const result = await encodeCurrentMix();
      if (result) {
        await saveAudioToGallery({
          id: crypto.randomUUID(),
          name: "mix",
          blob: result.blob,
          format: result.ext,
          durationSeconds: result.durationSec,
          savedAt: Date.now(),
        });
        flash(`Saved — visible on the Dashboard${trimNote(result.trimDb)}`);
      }
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDownloadWav() {
    if (timeline.clips.length === 0) return;
    setIsBusy(true);
    try {
      const { buffer, trimDb } = await renderForExport();
      downloadBlob(audioBufferToWav(buffer), "mix.wav");
      if (trimDb > 0) flash(`Downloaded${trimNote(trimDb)}`);
    } finally {
      setIsBusy(false);
    }
  }

  if (!projectLoaded) {
    return (
      <div className="dashboard">
        <header className="dashboard-header">
          <button type="button" className="add-title-button" onClick={onBack} title="Back to Dashboard">
            ← Dashboard
          </button>
          <h1>Audio Editor</h1>
          <div className="inline-fields" />
        </header>
        <p className="hint" style={{ padding: 24 }}>
          Restoring your last session…
        </p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <button type="button" className="add-title-button" onClick={onBack} title="Back to Dashboard">
          ← Dashboard
        </button>
        <h1>Audio Editor</h1>
        <div className="inline-fields">
          {status && <span className="ie-status">{status}</span>}
          <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Cmd/Ctrl+Z)">
            ↶ Undo
          </button>
          <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Cmd/Ctrl+Shift+Z)">
            ↷ Redo
          </button>
          <button type="button" onClick={handleSave} disabled={isBusy || timeline.clips.length === 0}>
            Save
          </button>
          <button type="button" onClick={handleDownloadWav} disabled={isBusy || timeline.clips.length === 0}>
            Download WAV
          </button>
          <button type="button" className="ie-primary" onClick={handleExport} disabled={isBusy || timeline.clips.length === 0}>
            {isBusy ? "Working…" : "Export"}
          </button>
        </div>
      </header>

      <div className="ie-body">
        <div className="ie-controls">
          <Section title="Sources">
            <label className="import-button">
              Import audio
              <input
                type="file"
                accept="audio/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) void addFiles(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />
            </label>
            {timeline.sources.length === 0 && (
              <p className="hint">Import or drop audio files. Each becomes a clip you can drag, trim, overlap, and mix.</p>
            )}
            {timeline.sources.length > 0 && (
              <p className="hint">Drag a source onto the timeline to place it, or use + to append it to lane 1.</p>
            )}
            <ul className="ae-source-list">
              {timeline.sources.map((s) => (
                <li
                  key={s.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData(SOURCE_DRAG_TYPE, s.id)}
                  title="Drag onto the timeline to place"
                >
                  <span className="ae-source-name">{s.name}</span>
                  <span className="ae-source-dur">{formatClock(s.buffer.duration)}</span>
                  <button
                    type="button"
                    title="Add another clip from this source"
                    onClick={() => {
                      const src = s;
                      commit((t) => {
                        const cursor = t.clips.filter((c) => c.laneIndex === 0).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
                        return { ...t, clips: [...t.clips, makeClip(src, 0, cursor)] };
                      });
                    }}
                  >
                    +
                  </button>
                  <button type="button" className="ae-source-remove" title="Remove source" onClick={() => removeSource(s.id)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Timeline">
            <SliderField label="Zoom" value={pxPerSec} min={20} max={400} step={10} onChange={setPxPerSec} format={(v) => `${v} px/s`} />
            <div className="field">
              <span>Lanes</span>
              <div className="inline-fields">
                <button type="button" onClick={() => setLaneCount(timeline.laneCount - 1)}>
                  −
                </button>
                <span className="ae-lane-count">{timeline.laneCount}</span>
                <button type="button" onClick={() => setLaneCount(timeline.laneCount + 1)}>
                  +
                </button>
              </div>
            </div>
          </Section>

          <MixHealthPanel report={mixHealth} busy={mixHealthBusy} hasClips={timeline.clips.length > 0} />

          <DuckingPanel ducking={timeline.ducking} onChange={updateDucking} />

          <Section title="Export format">
            <div className="inline-fields inline-fields-wrap">
              {AUDIO_FORMATS.map((f) => (
                <button key={f.id} type="button" className={format === f.id ? "active" : ""} onClick={() => setFormat(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            {AUDIO_FORMATS.find((f) => f.id === format)?.lossy && (
              <SliderField
                label="Bitrate"
                value={bitrateKbps}
                min={64}
                max={320}
                step={32}
                onChange={setBitrateKbps}
                format={(v) => `${v} kbps`}
              />
            )}
            <label className="ae-check">
              <input type="checkbox" checked={peakSafeExport} onChange={(e) => setPeakSafeExport(e.target.checked)} />
              <span>True-peak safe ({EXPORT_TRUE_PEAK_CEILING_DBTP} dBTP ceiling)</span>
            </label>
            <p className="hint">
              If the mix's true peak is over {EXPORT_TRUE_PEAK_CEILING_DBTP} dBTP, the whole mix is turned down by the difference before
              export — otherwise WAV hard-clips at 0 dBFS and MP3/AAC/Opus overshoot full scale when decoded. Never boosts a quiet mix.
            </p>
            {totalDur > 300 && <p className="hint">Long project — the intermediate WAV upload for compressed export may be large.</p>}
          </Section>

          {selectedClip && selectedSource && (
            <ClipInspector
              clip={selectedClip}
              source={selectedSource}
              orderIndex={selectedOrderIndex}
              laneCount={timeline.laneCount}
              playheadSec={playheadSec}
              onChange={(patch) => updateClip(selectedClip.id, patch)}
              onSplit={() => splitClip(selectedClip.id)}
              onDuplicate={() => duplicateClip(selectedClip.id)}
              onDelete={() => deleteClip(selectedClip.id)}
              onRippleDelete={() => rippleDelete(selectedClip.id)}
            />
          )}

          {selectedGap && !selectedClip && (
            <Section title="Gap">
              <p className="hint">
                {formatClock(selectedGap.startSec)} – {formatClock(selectedGap.endSec)} · lane {selectedGap.laneIndex + 1} ·{" "}
                {(selectedGap.endSec - selectedGap.startSec).toFixed(1)}s empty
              </p>
              <div className="inline-fields inline-fields-wrap">
                <button type="button" className="ie-primary" onClick={closeSelectedGap}>
                  Close gap
                </button>
              </div>
              <p className="hint">Removes this stretch and shifts every clip after it left, across all lanes.</p>
            </Section>
          )}
        </div>

        <div
          className={`ie-preview ae-preview${isDragOver ? " drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={() => setIsDragOver(false)}
        >
          {timeline.clips.length === 0 && <p className="hint">Import audio, or drop files here.</p>}
          {timeline.sources.length > 0 && (
            <div className="ae-stage">
              <AudioTimeline
                timeline={timeline}
                duckCurves={duckCurves}
                pxPerSec={pxPerSec}
                onZoomChange={setPxPerSec}
                playheadSec={playheadSec}
                selectedClipId={selectedClipId}
                onSelectClip={selectClip}
                selectedGap={selectedGap}
                onSelectGap={selectGap}
                onScrub={(sec) => {
                  setPlayheadSec(sec);
                  if (isPlaying) stopPlayback();
                }}
                onGestureStart={beginEdit}
                onClipLive={(id, patch) => updateClip(id, patch, { continuous: true })}
                onDropFiles={(files, laneIndex, startSec) => void addFiles(files, laneIndex, startSec)}
                onDropSourceId={dropExistingSource}
                onSplitClip={splitClip}
                onDuplicateClip={duplicateClip}
                onDeleteClip={deleteClip}
                onRippleDeleteClip={rippleDelete}
                notes={timeline.notes}
                openNoteId={openNoteId}
                onToggleNote={(id) => setOpenNoteId((current) => (current === id ? null : id))}
                onUpdateNoteText={updateNoteText}
                onDeleteNote={deleteNote}
              />
              <div className="ae-transport">
                <button type="button" onClick={() => (isPlaying ? stopPlayback() : play())} disabled={!mixBuffer}>
                  {isPlaying ? "❚❚ Pause" : "▶ Play"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopPlayback();
                    setPlayheadSec(0);
                  }}
                >
                  ⏮ Start
                </button>
                <span className="ae-time">
                  {formatClock(playheadSec)} / {formatClock(totalDur)}
                </span>
                <button type="button" onClick={addNoteAtPlayhead} title="Add a note at the playhead">
                  + Note
                </button>
                <span className="ae-transport-spacer" />
                <div className="ae-zoom">
                  <button
                    type="button"
                    title="Zoom out (or Ctrl/Cmd+scroll on the timeline)"
                    onClick={() => setPxPerSec((z) => Math.max(MIN_PX_PER_SEC, Math.round(z / 1.25)))}
                  >
                    −
                  </button>
                  <span className="ae-zoom-value">{Math.round(pxPerSec)} px/s</span>
                  <button
                    type="button"
                    title="Zoom in (or Ctrl/Cmd+scroll on the timeline)"
                    onClick={() => setPxPerSec((z) => Math.min(MAX_PX_PER_SEC, Math.round(z * 1.25)))}
                  >
                    +
                  </button>
                </div>
              </div>
              <LoudnessMeterPanel
                measurement={loudness}
                busy={mixHealthBusy}
                targetId={loudnessTargetId}
                onTargetChange={setLoudnessTargetId}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
