import { useEffect, useState } from "react";
import { analyzeImageStorage, formatBytes, purgeUnreferencedMedia, type ImageStorageReport } from "../imageEditor/storage.js";

function Row({ label, bytes, note }: { label: string; bytes: number; note?: string }) {
  return (
    <li className="storage-row">
      <span className="storage-row-label">{label}</span>
      <span className="storage-row-note">{note}</span>
      <span className="storage-row-bytes">{formatBytes(bytes)}</span>
    </li>
  );
}

export function StorageView() {
  const [report, setReport] = useState<ImageStorageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [lastCleanup, setLastCleanup] = useState<string | null>(null);

  async function refresh() {
    try {
      setReport(await analyzeImageStorage());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCleanup() {
    setCleaning(true);
    try {
      const result = await purgeUnreferencedMedia();
      setLastCleanup(
        result.deleted === 0
          ? "Nothing to remove."
          : `Removed ${result.deleted} unused file${result.deleted === 1 ? "" : "s"} (${formatBytes(result.bytes)}).`,
      );
      await refresh();
    } finally {
      setCleaning(false);
    }
  }

  if (error) return <p className="export-error">{error}</p>;
  if (!report) return <p className="hint">Measuring…</p>;

  const saved = report.mediaBytesIfCopied - report.media.bytes;
  const quotaPercent = report.quota && report.quota.quota > 0 ? (report.quota.usage / report.quota.quota) * 100 : null;

  return (
    <>
      <div className="dashboard-hero">
        <p className="hint">
          Everything below lives in this browser's IndexedDB. Sizes come from the stored records' own metadata, so measuring is cheap and
          exact. The browser's own figure includes its internal overhead and can lag behind recent writes by a while.
        </p>
      </div>

      {report.quota && (
        <section className="dashboard-section">
          <h2>Browser storage for this site</h2>
          <div className="storage-bar" title={`${formatBytes(report.quota.usage)} of ${formatBytes(report.quota.quota)}`}>
            <div className="storage-bar-fill" style={{ width: `${Math.min(100, Math.max(0.5, quotaPercent ?? 0))}%` }} />
          </div>
          <p className="hint">
            {formatBytes(report.quota.usage)} used of {formatBytes(report.quota.quota)} available
            {quotaPercent !== null && ` (${quotaPercent < 0.1 ? "<0.1" : quotaPercent.toFixed(1)}%)`}.
          </p>
        </section>
      )}

      <section className="dashboard-section">
        <div className="dashboard-section-header">
          <h2>Image Editor — {formatBytes(report.imageEditorBytes)}</h2>
          <button type="button" onClick={handleCleanup} disabled={cleaning || report.media.unusedCount === 0}>
            {cleaning ? "Cleaning…" : `Remove unused media (${formatBytes(report.media.unusedBytes)})`}
          </button>
        </div>
        {lastCleanup && <p className="hint">{lastCleanup}</p>}
        <ul className="storage-list">
          <Row
            label="Source photos, logos & background images"
            bytes={report.media.bytes}
            note={`${report.media.count} file${report.media.count === 1 ? "" : "s"}, ${report.media.sharedCount} shared between projects/templates${
              report.media.unusedCount > 0 ? `, ${report.media.unusedCount} unused` : ""
            }`}
          />
          <Row
            label="Project documents & thumbnails"
            bytes={report.projects.reduce((acc, p) => acc + p.docBytes + p.thumbnailBytes, 0)}
            note={`${report.projects.length} project${report.projects.length === 1 ? "" : "s"}`}
          />
          <Row label="Templates" bytes={report.templates.reduce((acc, t) => acc + t.bytes, 0)} note={`${report.templates.length} saved`} />
        </ul>
        {saved > 0 && (
          <p className="hint">
            Identical files are stored once and shared: keeping a copy per project and template would take {formatBytes(saved)} more.
          </p>
        )}
      </section>

      {report.projects.length > 0 && (
        <section className="dashboard-section">
          <h2>Per project</h2>
          <ul className="storage-list">
            {report.projects.map((p) => (
              <Row
                key={p.id}
                label={p.name}
                bytes={p.docBytes + p.thumbnailBytes + p.mediaBytes}
                note={`document ${formatBytes(p.docBytes)} · thumbnail ${formatBytes(p.thumbnailBytes)} · media ${formatBytes(p.mediaBytes)}${
                  p.mediaBytes !== p.exclusiveMediaBytes ? ` (${formatBytes(p.exclusiveMediaBytes)} only here)` : ""
                }`}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="dashboard-section">
        <h2>Everything else — {formatBytes(report.totalBytes - report.imageEditorBytes)}</h2>
        <ul className="storage-list">
          <Row label="Video editor local media" bytes={report.other.videoMedia} />
          <Row label="Audio editor media" bytes={report.other.audioMedia} />
          <Row label="Saved images (gallery)" bytes={report.other.savedImages} />
          <Row label="Saved audio (gallery)" bytes={report.other.savedAudio} />
        </ul>
      </section>
    </>
  );
}
