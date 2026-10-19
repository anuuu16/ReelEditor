import { useMemo, useRef, useState, type MouseEvent } from "react";
import type { EndBehavior, ExportJobSummary } from "@reel-studio/shared-types";
import { EXPORT_PRESETS, getTimelineDuration, layoutSequentialClips, OUTPUT_FORMATS, QUALITY_TIERS } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { getUsedSourceIds } from "../media/usedSources.js";
import { VIDEO_TRACK_ID } from "../state/initialProject.js";
import { startExport } from "../export/exportApi.js";
import { ExportJobRow } from "../export/ExportJobRow.js";
import {
  createTarget,
  duplicateTargetIds,
  fileNamesFor,
  outputFor,
  outputsFor,
  warningsFor,
  type ExportTarget,
} from "../export/exportTargets.js";
import { isActiveExport, useExportJobs } from "../export/useExportJobs.js";

const ENDING_LABELS: Record<EndBehavior, string> = { black: "black", freeze: "frame freeze", trim: "trimmed" };
const MAX_TARGETS = 12;

// Tenths only when they matter ("12s", "6.5s", "1m 2.5s").
function formatSeconds(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const m = Math.floor(tenths / 600);
  const rest = (tenths - m * 600) / 10;
  const s = Number.isInteger(rest) ? String(rest) : rest.toFixed(1);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// What the header button says while something is rendering: "Exporting · 43%", or for a batch
// "Exporting 3 · 43%" (the mean of what's running), or "Export · 2 queued" while nothing has started.
function headerLabel(jobs: ExportJobSummary[]): string {
  const active = jobs.filter(isActiveExport);
  if (active.length === 0) return "Export";
  const running = active.filter((j) => j.status === "running");
  if (running.length === 0) return `Export · ${active.length} queued`;
  const percent = Math.round(running.reduce((sum, j) => sum + j.percent, 0) / running.length);
  return active.length === 1 ? `Exporting · ${percent}%` : `Exporting ${active.length} · ${percent}%`;
}

// The Export button in the header, and the panel it opens. Two halves: the outputs to render
// (any number of size/format rows, sent as one upload) and the queue of what's rendering or
// rendered — which lives on the render service, so it's all still there after a reload or a
// service restart; only an upload that was still in flight is lost.
export function ExportPanel() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const { project } = state;
  const [isOpen, setIsOpen] = useState(false);
  const [targets, setTargets] = useState<ExportTarget[]>(() => [createTarget()]);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const { jobs, connection, addJobs, cancel, remove, retry, move, clearFinished } = useExportJobs(project.id);
  const lineLength = jobs.filter((j) => j.status === "queued").length;

  const videoClips = layoutSequentialClips(project.clips.filter((c) => c.trackId === VIDEO_TRACK_ID));
  // The same length the player/timeline show — and exactly the length of the exported file.
  const totalDuration = getTimelineDuration(project);

  const usedVideoSourceIds = new Set(videoClips.map((c) => c.sourceId));
  const usedVideoSources = project.sources.filter((s) => s.kind === "video" && usedVideoSourceIds.has(s.id));
  const maxSourceLongEdge = usedVideoSources.length ? Math.max(...usedVideoSources.map((s) => Math.max(s.width, s.height))) : 0;

  const placeholderClipCount = getUsedSourceIds(project).filter((id) => project.sources.find((s) => s.id === id)?.isPlaceholder).length;

  const fileNames = useMemo(() => fileNamesFor(targets, project), [targets, project]);
  const duplicates = useMemo(() => duplicateTargetIds(targets), [targets]);
  const hasActive = jobs.some(isActiveExport);
  const finishedCount = jobs.filter((j) => !isActiveExport(j)).length;

  function updateTarget(id: string, patch: Partial<ExportTarget>) {
    setTargets((current) => current.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function addTarget() {
    setTargets((current) => {
      if (current.length >= MAX_TARGETS) return current;
      const last = current[current.length - 1];
      // A new row starts as a copy of the last one, with the next format along — the common case
      // is "the same thing, also as …".
      const formatIds = OUTPUT_FORMATS.map((f) => f.id);
      const nextFormat = last ? formatIds[(formatIds.indexOf(last.format) + 1) % formatIds.length] : undefined;
      return [...current, createTarget(last ? { presetId: last.presetId, qualityId: last.qualityId, format: nextFormat } : {})];
    });
  }

  function removeTarget(id: string) {
    setTargets((current) => (current.length > 1 ? current.filter((t) => t.id !== id) : current));
  }

  function matchPresetAspect(presetId: string) {
    const preset = EXPORT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    dispatch({ type: "SET_ASPECT", aspectRatio: preset.aspectRatio, width: preset.width, height: preset.height });
  }

  async function runExport() {
    setIsUploading(true);
    setErrorMessage(null);
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    try {
      const created = await startExport(project, outputsFor(targets, project), controller.signal);
      addJobs(created);
    } catch (err) {
      if (!controller.signal.aborted) setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      setIsUploading(false);
    }
  }

  function cancelUpload() {
    uploadAbortRef.current?.abort();
  }

  function stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  if (!isOpen) {
    return (
      <button type="button" className={`export-button${hasActive ? " export-button-active" : ""}`} onClick={() => setIsOpen(true)}>
        {headerLabel(jobs)}
      </button>
    );
  }

  const canExport = !isUploading && placeholderClipCount === 0 && totalDuration > 0 && targets.length > 0;

  return (
    <div className="export-overlay" onClick={() => setIsOpen(false)}>
      <div className="export-panel export-panel-wide" onClick={stopPropagation}>
        <button type="button" className="export-close" onClick={() => setIsOpen(false)} title="Close">
          ×
        </button>
        <h2>Export reel</h2>

        <div className="export-targets">
          {targets.map((target, index) => {
            const output = outputFor(target, project);
            const warnings = warningsFor(target, project, totalDuration, maxSourceLongEdge);
            return (
              <div key={target.id} className="export-target">
                <div className="export-target-row">
                  <select
                    aria-label="Platform"
                    value={target.presetId ?? ""}
                    onChange={(e) => updateTarget(target.id, { presetId: e.target.value || null })}
                  >
                    <option value="">Project canvas ({project.canvas.aspectRatio})</option>
                    {EXPORT_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Quality"
                    value={target.qualityId}
                    onChange={(e) => updateTarget(target.id, { qualityId: e.target.value })}
                  >
                    {QUALITY_TIERS.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Format"
                    value={target.format}
                    onChange={(e) => updateTarget(target.id, { format: e.target.value as ExportTarget["format"] })}
                  >
                    {OUTPUT_FORMATS.map((format) => (
                      <option key={format.id} value={format.id} title={format.description}>
                        {format.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="export-target-remove"
                    onClick={() => removeTarget(target.id)}
                    disabled={targets.length === 1}
                    title="Remove this output"
                    aria-label="Remove this output"
                  >
                    ×
                  </button>
                </div>
                <p className="hint export-target-name">
                  {output.width}×{output.height} · {fileNames[index]}
                  {duplicates.has(target.id) && <span className="export-warning"> — same as an output above</span>}
                </p>
                {warnings.aspectMismatch && (
                  <p className="export-warning">
                    {warnings.aspectMismatch.label} is usually {warnings.aspectMismatch.aspectRatio}; this project is currently{" "}
                    {project.canvas.aspectRatio}.{" "}
                    <button type="button" className="export-warning-action" onClick={() => matchPresetAspect(warnings.aspectMismatch!.id)}>
                      Switch to {warnings.aspectMismatch.aspectRatio}
                    </button>
                  </p>
                )}
                {warnings.overDuration && (
                  <p className="export-warning">
                    This reel is {formatSeconds(totalDuration)}, longer than {warnings.overDuration.label}'s{" "}
                    {formatSeconds(warnings.overDuration.maxDurationSeconds!)} limit. It will still export — trim it first if it needs to
                    fit.
                  </p>
                )}
                {warnings.upscaleFrom && (
                  <p className="export-warning">
                    Source footage tops out around {warnings.upscaleFrom}px, lower than the {Math.max(output.width, output.height)}px this
                    output renders at — it will be upscaled and may look soft.
                  </p>
                )}
                {warnings.silent && <p className="export-warning">GIF has no sound and is best kept short and small.</p>}
              </div>
            );
          })}
          <button type="button" className="export-add-target" onClick={addTarget} disabled={targets.length >= MAX_TARGETS}>
            + Add another output
          </button>
        </div>

        {placeholderClipCount > 0 && (
          <p className="export-warning">
            This project has {placeholderClipCount} placeholder clip{placeholderClipCount === 1 ? "" : "s"} from a template — use each one's
            "Replace media" control to add your own footage before exporting.
          </p>
        )}

        {totalDuration === 0 && <p className="export-warning">The timeline is empty — add a clip, some audio or a title first.</p>}

        <p className="hint">
          Renders the current project locally through ffmpeg — {formatSeconds(totalDuration)} long, the same length the player shows (
          {ENDING_LABELS[project.endBehavior]} once the video runs out — change this in the timeline). Media is uploaded once; the outputs
          then render one after another, in this order.
        </p>

        {errorMessage && <p className="export-error">{errorMessage}</p>}

        <div className="export-actions">
          {isUploading ? (
            <>
              <span className="hint export-uploading">Uploading media…</span>
              <button type="button" onClick={cancelUpload}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={runExport} disabled={!canExport}>
              {targets.length === 1 ? "Start export" : `Export ${targets.length} files`}
            </button>
          )}
        </div>

        {(jobs.length > 0 || connection === "offline") && (
          <div className="export-queue">
            <div className="export-queue-header">
              <h3>Exports</h3>
              {connection === "offline" && <span className="export-warning">Render service unreachable — reconnecting…</span>}
              {finishedCount > 0 && (
                <button type="button" className="export-link-button" onClick={clearFinished}>
                  Clear finished
                </button>
              )}
            </div>
            <ul className="export-jobs">
              {jobs.map((job) => (
                <ExportJobRow
                  key={job.id}
                  job={job}
                  onCancel={() => cancel(job.id)}
                  onRemove={() => remove(job.id)}
                  onRetry={() => retry(job.id)}
                  onMove={(direction) => move(job.id, direction)}
                  lineLength={lineLength}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
