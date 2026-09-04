import type { MediaSource } from "@reel-studio/shared-types";

interface MediaPreviewModalProps {
  source: MediaSource;
  onClose: () => void;
}

function stopPropagation(e: { stopPropagation: () => void }) {
  e.stopPropagation();
}

// A large look at one media item — click a thumbnail in the library to open it. Same
// backdrop/panel/close pattern as ExportPanel/SlideshowDialog (.export-overlay, click-outside-to-close).
export function MediaPreviewModal({ source, onClose }: MediaPreviewModalProps) {
  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="media-preview-panel" onClick={stopPropagation}>
        <button type="button" className="export-close" onClick={onClose} title="Close">
          ×
        </button>
        <h2>{source.name}</h2>
        <div className="media-preview-stage">
          {source.kind === "video" && <video className="media-preview-media" src={source.previewUrl} controls autoPlay />}
          {source.kind === "image" && <img className="media-preview-media" src={source.previewUrl} alt={source.name} />}
          {source.kind === "audio" && <audio className="media-preview-audio" src={source.previewUrl} controls autoPlay />}
        </div>
        <p className="hint">
          {source.kind !== "audio" && `${source.width}×${source.height}`}
          {source.kind === "video" && ` · ${source.durationSeconds.toFixed(1)}s`}
          {source.kind === "audio" && `${source.durationSeconds.toFixed(1)}s`}
        </p>
      </div>
    </div>
  );
}
