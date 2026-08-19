import { useState, type MouseEvent } from "react";
import {
  computeExportDimensions,
  EXPORT_PRESETS,
  getProjectDuration,
  layoutSequentialClips,
  QUALITY_TIERS,
} from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { loadMediaBlob } from "../persistence/db.js";
import { getUsedSourceIds } from "../media/usedSources.js";
import { VIDEO_TRACK_ID } from "../state/initialProject.js";
import { RENDER_SERVICE_URL } from "../constants.js";

type ExportPhase = "idle" | "uploading" | "rendering" | "done" | "error";

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function ExportPanel() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [percent, setPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [qualityId, setQualityId] = useState<string>("1080p");

  const videoClips = layoutSequentialClips(state.project.clips.filter((c) => c.trackId === VIDEO_TRACK_ID));
  const totalDuration = getProjectDuration(state.project);
  const selectedPreset = EXPORT_PRESETS.find((p) => p.id === presetId) ?? null;
  const aspectMismatch = selectedPreset && selectedPreset.aspectRatio !== state.project.canvas.aspectRatio;
  const overDuration = selectedPreset?.maxDurationSeconds != null && totalDuration > selectedPreset.maxDurationSeconds;

  const qualityTier = QUALITY_TIERS.find((q) => q.id === qualityId) ?? QUALITY_TIERS[2];
  const exportDimensions = computeExportDimensions(state.project.canvas.width, state.project.canvas.height, qualityTier.scale);

  const usedVideoSourceIds = new Set(videoClips.map((c) => c.sourceId));
  const usedVideoSources = state.project.sources.filter((s) => s.kind === "video" && usedVideoSourceIds.has(s.id));
  const maxSourceLongEdge = usedVideoSources.length
    ? Math.max(...usedVideoSources.map((s) => Math.max(s.width, s.height)))
    : 0;
  const targetLongEdge = Math.max(exportDimensions.width, exportDimensions.height);
  const willUpscale = maxSourceLongEdge > 0 && targetLongEdge > maxSourceLongEdge;

  function reset() {
    eventSource?.close();
    setEventSource(null);
    setPhase("idle");
    setPercent(0);
    setErrorMessage(null);
    setJobId(null);
  }

  function openPanel() {
    reset();
    setIsOpen(true);
  }

  function closePanel() {
    eventSource?.close();
    setIsOpen(false);
  }

  function matchPresetAspect() {
    if (!selectedPreset) return;
    dispatch({
      type: "SET_ASPECT",
      aspectRatio: selectedPreset.aspectRatio,
      width: selectedPreset.width,
      height: selectedPreset.height,
    });
  }

  async function startExport() {
    setPhase("uploading");
    setErrorMessage(null);

    const usedSourceIds = getUsedSourceIds(state.project);
    const formData = new FormData();
    formData.append("project", JSON.stringify(state.project));
    formData.append("width", String(exportDimensions.width));
    formData.append("height", String(exportDimensions.height));

    try {
      for (const sourceId of usedSourceIds) {
        const blob = await loadMediaBlob(sourceId);
        if (!blob) {
          const source = state.project.sources.find((s) => s.id === sourceId);
          throw new Error(`Missing stored file for "${source?.name ?? sourceId}" — re-import it before exporting.`);
        }
        formData.append(`media_${sourceId}`, blob, sourceId);
      }
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
      return;
    }

    let response: Response;
    try {
      response = await fetch(`${RENDER_SERVICE_URL}/render`, { method: "POST", body: formData });
    } catch {
      setPhase("error");
      setErrorMessage(
        `Couldn't reach the render service at ${RENDER_SERVICE_URL}. Make sure it's running (pnpm --filter @reel-studio/render-service dev).`
      );
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "Export request failed" }));
      setPhase("error");
      setErrorMessage(body.error ?? "Export request failed");
      return;
    }

    const { jobId: newJobId } = await response.json();
    setJobId(newJobId);
    setPhase("rendering");

    const source = new EventSource(`${RENDER_SERVICE_URL}/render/${newJobId}/events`);
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "progress") setPercent(data.percent);
      if (data.type === "done") {
        setPercent(100);
        setPhase("done");
        source.close();
      }
      if (data.type === "error") {
        setPhase("error");
        setErrorMessage(data.message);
        source.close();
      }
      if (data.type === "cancelled") {
        setPhase("idle");
        source.close();
      }
    };
    setEventSource(source);
  }

  function cancelExport() {
    if (jobId) {
      fetch(`${RENDER_SERVICE_URL}/render/${jobId}/cancel`, { method: "POST" }).catch(() => {});
    }
    reset();
  }

  function stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  if (!isOpen) {
    return (
      <button type="button" className="export-button" onClick={openPanel}>
        Export
      </button>
    );
  }

  return (
    <div className="export-overlay" onClick={closePanel}>
      <div className="export-panel" onClick={stopPropagation}>
        <button type="button" className="export-close" onClick={closePanel} title="Close">
          ×
        </button>
        <h2>Export reel</h2>

        {phase === "idle" && (
          <>
            <div className="field">
              <span>Platform (optional — checks aspect ratio &amp; duration limit)</span>
              <div className="inline-fields inline-fields-wrap">
                {EXPORT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={presetId === preset.id ? "active" : ""}
                    onClick={() => setPresetId(presetId === preset.id ? null : preset.id)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {aspectMismatch && (
              <p className="export-warning">
                {selectedPreset!.label} is usually {selectedPreset!.aspectRatio}; this project is currently{" "}
                {state.project.canvas.aspectRatio}.{" "}
                <button type="button" className="export-warning-action" onClick={matchPresetAspect}>
                  Switch to {selectedPreset!.aspectRatio}
                </button>
              </p>
            )}

            {overDuration && (
              <p className="export-warning">
                This reel is {formatSeconds(totalDuration)}, longer than {selectedPreset!.label}'s
                {" "}
                {formatSeconds(selectedPreset!.maxDurationSeconds!)} limit. It will still export — trim it first if it needs
                to fit.
              </p>
            )}

            <div className="field">
              <span>Quality</span>
              <div className="inline-fields">
                {QUALITY_TIERS.map((tier) => (
                  <button
                    key={tier.id}
                    type="button"
                    className={qualityId === tier.id ? "active" : ""}
                    onClick={() => setQualityId(tier.id)}
                  >
                    {tier.label}
                  </button>
                ))}
              </div>
            </div>

            {willUpscale && (
              <p className="export-warning">
                Your source footage tops out around {maxSourceLongEdge}px, lower than the {targetLongEdge}px this quality
                renders at — video will be upscaled and may look soft. Pick a lower quality for a crisper result, or keep
                this one if file size/resolution matters more than sharpness.
              </p>
            )}

            <p className="hint">
              Renders the current project locally through ffmpeg at {exportDimensions.width}×{exportDimensions.height}{" "}
              ({qualityTier.label}).
            </p>
            <button type="button" onClick={startExport}>
              Start export
            </button>
          </>
        )}

        {(phase === "uploading" || phase === "rendering") && (
          <>
            <div className="export-progress-track">
              <div className="export-progress-fill" style={{ width: `${phase === "uploading" ? 4 : percent}%` }} />
            </div>
            <p className="hint">{phase === "uploading" ? "Uploading media…" : `Rendering… ${percent}%`}</p>
            <button type="button" onClick={cancelExport}>
              Cancel
            </button>
          </>
        )}

        {phase === "done" && jobId && (
          <>
            <p className="hint">Done.</p>
            <a className="export-download" href={`${RENDER_SERVICE_URL}/render/${jobId}/result`} download="reel.mp4">
              Download reel.mp4
            </a>
          </>
        )}

        {phase === "error" && (
          <>
            <p className="export-error">{errorMessage}</p>
            <button type="button" onClick={startExport}>
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  );
}
