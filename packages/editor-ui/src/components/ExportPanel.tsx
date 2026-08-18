import { useState, type MouseEvent } from "react";
import { useEditorState } from "../state/EditorContext.js";
import { loadMediaBlob } from "../persistence/db.js";

const RENDER_SERVICE_URL = "http://localhost:4310";

type ExportPhase = "idle" | "uploading" | "rendering" | "done" | "error";

export function ExportPanel() {
  const state = useEditorState();
  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [percent, setPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);

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

  async function startExport() {
    setPhase("uploading");
    setErrorMessage(null);

    const usedSourceIds = [...new Set(state.project.clips.map((c) => c.sourceId))];
    const formData = new FormData();
    formData.append("project", JSON.stringify(state.project));

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
            <p className="hint">
              Renders the current project locally through ffmpeg at {state.project.canvas.width}×{state.project.canvas.height}.
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
