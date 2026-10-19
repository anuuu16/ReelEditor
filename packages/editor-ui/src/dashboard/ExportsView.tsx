import { useNavigate } from "react-router-dom";
import { ExportJobRow } from "../export/ExportJobRow.js";
import { formatBytes } from "../export/exportTargets.js";
import { isActiveExport, useExportJobs } from "../export/useExportJobs.js";

// Every export the render service has, across all projects — the same live list the editor's
// Export panel shows for one project. It lives on the service (and on its disk), so this page is
// just a window onto it: reload it, come back tomorrow, open it in a second tab while the first
// is still rendering — it's all the same queue. Finished files are kept until they're removed
// here (or expire after a day), which is also where they can be cleared in one go.
export function ExportsView() {
  const navigate = useNavigate();
  const { jobs, connection, cancel, remove, retry, move, clearFinished } = useExportJobs(null);
  const lineLength = jobs.filter((j) => j.status === "queued").length;

  const active = jobs.filter(isActiveExport);
  const finished = jobs.filter((job) => !isActiveExport(job));
  const finishedBytes = finished.reduce((sum, job) => sum + (job.outputBytes ?? 0), 0);

  function handleClearFinished() {
    const sizeNote = finishedBytes > 0 ? ` and delete ${formatBytes(finishedBytes)} from disk` : "";
    if (
      !window.confirm(
        `Remove ${finished.length} completed export${finished.length === 1 ? "" : "s"}${sizeNote}? Downloads you already saved are unaffected.`,
      )
    ) {
      return;
    }
    clearFinished();
  }

  return (
    <>
      <div className="dashboard-hero">
        <p className="hint">
          {jobs.length === 0
            ? "Nothing has been exported yet. Open a project and use Export — what renders shows up here, and stays until you remove it."
            : `${jobs.length} export${jobs.length === 1 ? "" : "s"}${active.length > 0 ? ` · ${active.length} in progress` : ""} · ${formatBytes(finishedBytes)} of finished files on disk. Finished files are kept for a day, or until removed here.`}
        </p>
        {connection === "offline" && <p className="export-warning">Render service unreachable — reconnecting…</p>}
        {jobs.length === 0 && (
          <button type="button" className="dashboard-new-project" onClick={() => navigate("/")}>
            Go to video projects
          </button>
        )}
      </div>

      {jobs.length > 0 && (
        <section className="dashboard-section exports-section">
          <div className="dashboard-section-header">
            <h2>Queue &amp; results</h2>
            <button
              type="button"
              onClick={handleClearFinished}
              disabled={finished.length === 0}
              title="Remove every finished, failed or cancelled export and delete its file"
            >
              Clear all completed ({finished.length})
            </button>
          </div>
          <ul className="export-jobs">
            {jobs.map((job) => (
              <ExportJobRow
                key={job.id}
                job={job}
                detailed
                onCancel={() => cancel(job.id)}
                onRemove={() => remove(job.id)}
                onRetry={() => retry(job.id)}
                onMove={(direction) => move(job.id, direction)}
                lineLength={lineLength}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
