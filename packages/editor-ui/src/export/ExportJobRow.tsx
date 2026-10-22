import { useState } from "react";
import type { ExportJobSummary, QueueMoveDirection } from "@reel-studio/shared-types";
import { getOutputFormat } from "@reel-studio/timeline-core";
import { exportResultUrl } from "./exportApi.js";
import { formatBytes, formatDuration, formatRelativeTime } from "./exportTargets.js";
import { isActiveExport } from "./useExportJobs.js";

export function exportStatusLabel(job: ExportJobSummary): string {
  switch (job.status) {
    case "queued":
      return job.queuePosition ? `Queued · #${job.queuePosition} in line` : "Queued";
    case "running":
      return `Rendering… ${job.percent}%`;
    case "done":
      return job.outputBytes != null ? `Done · ${formatBytes(job.outputBytes)}` : "Done";
    case "error":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return job.status;
  }
}

// What's worth knowing about an export beyond its name: which project, what was asked for, how
// long the reel is, when it was made and how long it took — the Dashboard's list shows all of it,
// the editor's panel (which already knows the project) keeps to the essentials.
export function exportDetails(job: ExportJobSummary, now = Date.now()): string[] {
  const details = [
    `${job.output.width}×${job.output.height} ${getOutputFormat(job.output.format).label}${job.output.label ? ` · ${job.output.label}` : ""}`,
    `${formatDuration(job.totalDurationSeconds)} reel`,
  ];
  if (job.status === "done" && job.finishedAt && job.startedAt)
    details.push(`rendered in ${formatDuration((job.finishedAt - job.startedAt) / 1000)}`);
  details.push(
    `${job.status === "done" ? "finished" : "started"} ${formatRelativeTime(job.finishedAt ?? job.startedAt ?? job.createdAt, now)}`,
  );
  return details;
}

interface ExportJobRowProps {
  job: ExportJobSummary;
  /** Show the project name and the full detail line (the Dashboard); off inside the editor. */
  detailed?: boolean;
  /** How many jobs are waiting in line, so the move buttons know when a job is already at an end. */
  lineLength?: number;
  onCancel: () => void;
  onRemove: () => void;
  onRetry: () => Promise<string | null>;
  onMove?: (direction: QueueMoveDirection) => Promise<string | null>;
}

export function ExportJobRow({ job, detailed = false, lineLength = 0, onCancel, onRemove, onRetry, onMove }: ExportJobRowProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const active = isActiveExport(job);
  const canRetry = job.status === "error" || job.status === "cancelled";
  const position = job.queuePosition ?? 0;
  const canMove = job.status === "queued" && !!onMove && lineLength > 1;

  async function run(action: () => Promise<string | null>) {
    setIsBusy(true);
    setActionError(await action());
    setIsBusy(false);
  }

  return (
    <li className={`export-job export-job-${job.status}`}>
      <div className="export-job-main">
        <span className="export-job-name" title={job.downloadName}>
          {detailed && <span className="export-job-project">{job.projectName} · </span>}
          {job.downloadName}
        </span>
        <span className="export-job-status">{exportStatusLabel(job)}</span>
      </div>
      {detailed && <p className="hint export-job-details">{exportDetails(job).join(" · ")}</p>}
      {job.status === "running" && (
        <div className="export-progress-track">
          <div className="export-progress-fill" style={{ width: `${job.percent}%` }} />
        </div>
      )}
      {job.status === "error" && job.errorMessage && <p className="export-error">{job.errorMessage}</p>}
      {job.status === "done" && job.warning && <p className="export-warning">{job.warning}</p>}
      {actionError && <p className="export-error">{actionError}</p>}
      <div className="export-job-actions">
        {canMove && (
          <span className="export-job-move" role="group" aria-label="Move in line">
            <button type="button" onClick={() => run(() => onMove!("front"))} disabled={isBusy || position <= 1} title="Render this next">
              ⇈ First
            </button>
            <button type="button" onClick={() => run(() => onMove!("up"))} disabled={isBusy || position <= 1} title="Render sooner">
              ↑
            </button>
            <button
              type="button"
              onClick={() => run(() => onMove!("down"))}
              disabled={isBusy || position >= lineLength}
              title="Render later"
            >
              ↓
            </button>
          </span>
        )}
        {job.status === "done" && (
          <a className="export-download" href={exportResultUrl(job.id)} download={job.downloadName}>
            Download
          </a>
        )}
        {active && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        {canRetry && (
          <button type="button" onClick={() => run(onRetry)} disabled={isBusy} title="Run this export again with the same settings">
            Retry
          </button>
        )}
        {!active && (
          <button type="button" className="export-link-button" onClick={onRemove} title="Forget this export and delete its file">
            Remove
          </button>
        )}
      </div>
    </li>
  );
}
