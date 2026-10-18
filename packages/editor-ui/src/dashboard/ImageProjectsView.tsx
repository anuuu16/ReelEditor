import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatProjectDate } from "../persistence/useProjectBrowser.js";
import type { ImageProjectRecord } from "../persistence/db.js";
import {
  analyzeImageStorage,
  deleteImageProjectAndMedia,
  duplicateImageProject,
  formatBytes,
  listImageProjectsWithMigration,
  type ProjectStorage,
} from "../imageEditor/storage.js";

interface Entry extends ImageProjectRecord {
  thumbnailUrl: string | null;
  storage: ProjectStorage | null;
}

export function ImageProjectsView() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    try {
      const [projects, report] = await Promise.all([listImageProjectsWithMigration(), analyzeImageStorage()]);
      const storageById = new Map(report.projects.map((p) => [p.id, p]));
      setEntries(
        projects.map((p) => ({
          ...p,
          thumbnailUrl: p.thumbnail ? URL.createObjectURL(p.thumbnail) : null,
          storage: storageById.get(p.id) ?? null,
        })),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    return () => entries.forEach((e) => e.thumbnailUrl && URL.revokeObjectURL(e.thumbnailUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  async function handleDuplicate(id: string) {
    setBusyId(id);
    try {
      await duplicateImageProject(id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(entry: Entry) {
    const frees = entry.storage
      ? ` Frees ${formatBytes(entry.storage.exclusiveMediaBytes + entry.storage.docBytes + entry.storage.thumbnailBytes)}.`
      : "";
    if (!window.confirm(`Delete "${entry.name}"?${frees}`)) return;
    setBusyId(entry.id);
    try {
      await deleteImageProjectAndMedia(entry.id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="dashboard-hero">
        <button type="button" className="dashboard-new-project" onClick={() => navigate("/image-editor")}>
          + New image project
        </button>
        <p className="hint">
          Every image project autosaves as you work and is kept in this browser. Open one to pick up where you left off — undo history
          starts fresh, everything else is exactly as you left it.
        </p>
      </div>

      {error && <p className="export-error">{error}</p>}

      <section className="dashboard-section">
        <h2>Image projects</h2>
        <ul className="project-list">
          {loaded && entries.length === 0 && <p className="hint">No image projects yet — start one above.</p>}
          {entries.map((entry) => (
            <li key={entry.id} className="project-list-item">
              <div className="project-list-thumb">{entry.thumbnailUrl && <img src={entry.thumbnailUrl} alt="" />}</div>
              <div className="project-list-info">
                <span className="project-list-name">{entry.name}</span>
                <span className="project-list-meta">
                  {entry.doc.canvas.width}×{entry.doc.canvas.height} · {entry.doc.layers.length} layer
                  {entry.doc.layers.length === 1 ? "" : "s"}
                  {entry.storage && ` · ${formatBytes(entry.storage.docBytes + entry.storage.thumbnailBytes + entry.storage.mediaBytes)}`}
                  {entry.storage && entry.storage.mediaBytes > entry.storage.exclusiveMediaBytes && " (media shared)"} ·{" "}
                  {formatProjectDate(entry.updatedAt)}
                </span>
              </div>
              <button type="button" disabled={busyId === entry.id} onClick={() => navigate(`/image-editor/${entry.id}`)}>
                Open
              </button>
              <button
                type="button"
                className="project-secondary-button"
                disabled={busyId === entry.id}
                onClick={() => handleDuplicate(entry.id)}
              >
                Duplicate
              </button>
              <button type="button" className="project-delete-button" disabled={busyId === entry.id} onClick={() => handleDelete(entry)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
