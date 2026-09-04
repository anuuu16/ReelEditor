import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SliderField } from "./imageEditor/SliderField.js";
import { saveAudioToGallery } from "./persistence/db.js";
import { decodeAudioFile } from "./audioEditor/decodeAudio.js";
import { audioBufferToWav } from "./audioEditor/audioBufferToWav.js";
import { mixdown } from "./audioEditor/mixdown.js";
import { AUDIO_FORMATS, encodeAudio, identitySpec, type AudioExportFormat } from "./audioEditor/api.js";
import { AudioTimeline } from "./audioEditor/AudioTimeline.js";
import { ClipInspector } from "./audioEditor/ClipInspector.js";
import { useAudioTimelineHistory } from "./audioEditor/useAudioTimelineHistory.js";
import {
  clipEnd,
  clipVisibleDuration,
  DEFAULT_LANE_COUNT,
  makeClip,
  splitClipAt,
  timelineDuration,
  type AudioClip,
  type AudioSource,
  type AudioTimeline as AudioTimelineModel,
} from "./audioEditor/timeline.js";

interface AudioEditorProps {
  onBack: () => void;
}

const EMPTY: AudioTimelineModel = { sources: [], clips: [], laneCount: DEFAULT_LANE_COUNT };

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
  const { timeline, commit, checkpoint, live, undo, redo, canUndo, canRedo } = useAudioTimelineHistory(EMPTY);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [pxPerSec, setPxPerSec] = useState(80);
  const [format, setFormat] = useState<AudioExportFormat>("mp3");
  const [bitrateKbps, setBitrateKbps] = useState(192);

  const [mixBuffer, setMixBuffer] = useState<AudioBuffer | null>(null);
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
  const selectedClip = timeline.clips.find((c) => c.id === selectedClipId) ?? null;
  const selectedSource = selectedClip ? timeline.sources.find((s) => s.id === selectedClip.sourceId) ?? null : null;

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

  // Any timeline edit stops playback (the mixed buffer is now stale).
  useEffect(() => {
    stopPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

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
    [commit, flash]
  );

  function updateClip(id: string, patch: Partial<AudioClip>, opts?: { continuous?: boolean }) {
    if (opts?.continuous) {
      beginEdit();
      live((t) => ({ ...t, clips: t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    } else {
      commit((t) => ({ ...t, clips: t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    }
  }

  function deleteClip(id: string) {
    commit((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== id) }));
    if (selectedClipId === id) setSelectedClipId(null);
  }

  function splitSelected() {
    if (!selectedClip) return;
    const parts = splitClipAt(selectedClip, playheadSec);
    if (!parts) {
      flash("Move the playhead inside the clip first");
      return;
    }
    commit((t) => ({
      ...t,
      clips: t.clips.flatMap((c) => (c.id === selectedClip.id ? parts : [c])),
    }));
    setSelectedClipId(parts[0].id);
  }

  function setLaneCount(n: number) {
    const next = Math.max(1, Math.min(8, n));
    commit((t) => ({
      ...t,
      laneCount: next,
      clips: t.clips.map((c) => (c.laneIndex >= next ? { ...c, laneIndex: next - 1 } : c)),
    }));
  }

  // --- keyboard ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedClipId) {
          e.preventDefault();
          deleteClip(selectedClipId);
        }
      } else if (e.key === " ") {
        e.preventDefault();
        isPlaying ? stopPlayback() : play();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, selectedClipId, isPlaying, mixBuffer, playheadSec]);

  function play() {
    if (!mixBuffer) return;
    stopPlayback();
    const ctx = (audioCtxRef.current ??= new (window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)());
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

  async function encodeCurrentMix(): Promise<{ blob: Blob; ext: string; durationSec: number } | null> {
    if (timeline.clips.length === 0) {
      flash("Add some audio first");
      return null;
    }
    const buffer = await mixdown(timeline);
    const wav = audioBufferToWav(buffer);
    const fmt = AUDIO_FORMATS.find((f) => f.id === format);
    if (format === "wav") return { blob: wav, ext: "wav", durationSec: buffer.duration };
    const blob = await encodeAudio({
      file: wav,
      spec: identitySpec(buffer.duration),
      format,
      bitrateKbps,
      name: "mix",
    });
    return { blob, ext: fmt?.ext ?? "mp3", durationSec: buffer.duration };
  }

  async function handleExport() {
    setIsBusy(true);
    try {
      const result = await encodeCurrentMix();
      if (result) {
        downloadBlob(result.blob, `mix.${result.ext}`);
        flash("Exported");
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
        flash("Saved — visible on the Dashboard");
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
      const buffer = await mixdown(timeline);
      downloadBlob(audioBufferToWav(buffer), "mix.wav");
    } finally {
      setIsBusy(false);
    }
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
            {timeline.sources.length === 0 && <p className="hint">Import or drop audio files. Each becomes a clip you can drag, trim, overlap, and mix.</p>}
            <ul className="ae-source-list">
              {timeline.sources.map((s) => (
                <li key={s.id}>
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
            {totalDur > 300 && <p className="hint">Long project — the intermediate WAV upload for compressed export may be large.</p>}
          </Section>

          {selectedClip && selectedSource && (
            <ClipInspector
              clip={selectedClip}
              source={selectedSource}
              laneCount={timeline.laneCount}
              playheadSec={playheadSec}
              onChange={(patch) => updateClip(selectedClip.id, patch)}
              onSplit={splitSelected}
              onDelete={() => deleteClip(selectedClip.id)}
            />
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
                pxPerSec={pxPerSec}
                playheadSec={playheadSec}
                selectedClipId={selectedClipId}
                onSelectClip={setSelectedClipId}
                onScrub={(sec) => {
                  setPlayheadSec(sec);
                  if (isPlaying) stopPlayback();
                }}
                onGestureStart={beginEdit}
                onClipLive={(id, patch) => updateClip(id, patch, { continuous: true })}
                onDropFiles={(files, laneIndex, startSec) => void addFiles(files, laneIndex, startSec)}
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
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
