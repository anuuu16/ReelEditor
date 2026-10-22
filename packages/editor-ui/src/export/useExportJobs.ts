import { useCallback, useEffect, useRef, useState } from "react";
import type { ExportJobSummary, ExportStreamMessage, QueueMoveDirection } from "@reel-studio/shared-types";
import { cancelExportJob, deleteExportJob, moveExportJob, retryExportJob, subscribeExportJobs } from "./exportApi.js";

export type ExportConnection = "connecting" | "live" | "offline";

export interface ExportJobsState {
  /** Every job the service has for this project, newest first (a batch keeps its own order). */
  jobs: ExportJobSummary[];
  connection: ExportConnection;
  /** Slips freshly created jobs in ahead of the stream, so the panel shows them right away. */
  addJobs: (jobs: ExportJobSummary[]) => void;
  cancel: (jobId: string) => void;
  remove: (jobId: string) => void;
  /** Runs a failed/cancelled job again with the same settings. Resolves to an error message, or null. */
  retry: (jobId: string) => Promise<string | null>;
  /** Moves a waiting job in the line. Resolves to an error message, or null. */
  move: (jobId: string, direction: QueueMoveDirection) => Promise<string | null>;
  /** Forgets every finished/failed/cancelled job (and deletes their files on the service). */
  clearFinished: () => void;
}

export const ACTIVE_EXPORT_STATUSES = new Set(["queued", "running"]);

export function isActiveExport(job: ExportJobSummary): boolean {
  return ACTIVE_EXPORT_STATUSES.has(job.status);
}

// What's happening now on top, in the order it will happen: the job rendering, then the line
// (by rank — the order the service will pick them in, which the person can change), then
// everything finished, newest batch first and a batch in the order its outputs were asked for.
// Sorting here rather than trusting arrival order is necessary, not just nice: the stream's
// first events for a batch can land before the POST that created it has even answered.
function phase(job: ExportJobSummary): number {
  return job.status === "running" ? 0 : job.status === "queued" ? 1 : 2;
}

export function sortJobs(jobs: ExportJobSummary[]): ExportJobSummary[] {
  return [...jobs].sort((a, b) => {
    const byPhase = phase(a) - phase(b);
    if (byPhase !== 0) return byPhase;
    if (phase(a) < 2) return a.queueRank - b.queueRank;
    return b.createdAt - a.createdAt || a.batchIndex - b.batchIndex;
  });
}

export function applyStreamMessage(jobs: ExportJobSummary[], message: ExportStreamMessage): ExportJobSummary[] {
  switch (message.type) {
    case "snapshot":
      return sortJobs(message.jobs);
    case "job":
      return sortJobs([message.job, ...jobs.filter((j) => j.id !== message.job.id)]);
    case "removed":
      return jobs.filter((j) => j.id !== message.jobId);
    default:
      return jobs;
  }
}

// Follows the render service's queue for one project (or, with no id, for every project — the
// Dashboard's Exports view): a snapshot of every job on connect, then each change as it happens. The EventSource reconnects by itself if the service goes away and
// comes back, and every (re)connection starts with a fresh snapshot — so after a service restart
// the list is simply whatever the service restored from disk, with nothing stale left over.
export function useExportJobs(projectId: string | null): ExportJobsState {
  const [jobs, setJobs] = useState<ExportJobSummary[]>([]);
  const [connection, setConnection] = useState<ExportConnection>("connecting");
  // Jobs removed locally must not be resurrected by a "job" message that was already on the wire.
  const removedRef = useRef(new Set<string>());
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    setJobs([]);
    setConnection("connecting");
    removedRef.current = new Set();
    const unsubscribe = subscribeExportJobs(projectId, {
      onOpen: () => setConnection("live"),
      onError: () => setConnection("offline"),
      onMessage: (message) => {
        if (message.type === "job" && removedRef.current.has(message.job.id)) return;
        if (message.type === "snapshot") removedRef.current = new Set();
        setJobs((current) => applyStreamMessage(current, message));
      },
    });
    return unsubscribe;
  }, [projectId]);

  const addJobs = useCallback((created: ExportJobSummary[]) => {
    setJobs((current) => {
      const known = new Set(current.map((j) => j.id));
      return sortJobs([...created.filter((j) => !known.has(j.id)), ...current]);
    });
  }, []);

  const cancel = useCallback((jobId: string) => {
    void cancelExportJob(jobId);
  }, []);

  const remove = useCallback((jobId: string) => {
    removedRef.current.add(jobId);
    setJobs((current) => current.filter((j) => j.id !== jobId));
    void deleteExportJob(jobId);
  }, []);

  const retry = useCallback(async (jobId: string) => {
    try {
      const replacement = await retryExportJob(jobId);
      removedRef.current.add(jobId);
      setJobs((current) => sortJobs([replacement, ...current.filter((j) => j.id !== jobId && j.id !== replacement.id)]));
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }, []);

  const move = useCallback(async (jobId: string, direction: QueueMoveDirection) => {
    try {
      const line = await moveExportJob(jobId, direction);
      // The stream will say the same, but showing the new order at once is what makes it feel moved.
      const byId = new Map(line.map((j) => [j.id, j]));
      setJobs((current) => sortJobs(current.map((j) => byId.get(j.id) ?? j)));
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }, []);

  const clearFinished = useCallback(() => {
    const finished = jobsRef.current.filter((job) => !isActiveExport(job));
    for (const job of finished) {
      removedRef.current.add(job.id);
      void deleteExportJob(job.id);
    }
    setJobs((current) => current.filter(isActiveExport));
  }, []);

  return { jobs, connection, addJobs, cancel, remove, retry, move, clearFinished };
}
