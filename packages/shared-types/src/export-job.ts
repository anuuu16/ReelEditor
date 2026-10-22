// The render service's export queue, as the editor sees it over HTTP (GET /render, the
// /render/events stream). The service owns the full job (process handle, ffmpeg plan, work
// folder); this is the part that crosses the wire.

export type ExportFormatId = "mp4" | "webm" | "mov" | "gif";

export type ExportJobStatus = "queued" | "running" | "done" | "error" | "cancelled";

/** One requested output: pixel size, container/codec, and (optionally) what it's for. */
export interface ExportOutput {
  width: number;
  height: number;
  format: ExportFormatId;
  /** e.g. the platform preset's label ("Instagram Reel") — becomes part of the file name. */
  label: string | null;
}

export interface ExportJobSummary {
  id: string;
  /** Jobs created by one request (one upload, several outputs) share a batch id. */
  batchId: string;
  /** Position within that request's outputs (0-based) — the order to show a batch in. */
  batchIndex: number;
  projectId: string;
  projectName: string;
  output: ExportOutput;
  /** The file name the browser saves the result as. */
  downloadName: string;
  status: ExportJobStatus;
  /** 0–100 while rendering; 100 once done. */
  percent: number;
  totalDurationSeconds: number;
  errorMessage: string | null;
  /** Finished, but something is off about the result — e.g. it came out shorter than the timeline. */
  warning: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Size of the finished file, when known. */
  outputBytes: number | null;
  /** How much of the service's parallel capacity this job takes while it runs. */
  cost: number;
  /** 1-based place in the waiting line while queued, null otherwise. */
  queuePosition: number | null;
  /**
   * Where the job sits in the line: waiting jobs render in ascending rank. Assigned in creation
   * order; moving a job changes its rank (and survives a service restart, unlike queuePosition).
   */
  queueRank: number;
}

export type QueueMoveDirection = "front" | "up" | "down" | "back";

/** What the /render/events stream sends: a full snapshot first, then one message per change. */
export type ExportStreamMessage =
  | { type: "snapshot"; jobs: ExportJobSummary[] }
  | { type: "job"; job: ExportJobSummary; event: { type: string } }
  | { type: "removed"; jobId: string };
