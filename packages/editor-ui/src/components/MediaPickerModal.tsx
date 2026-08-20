import { useEffect, type MouseEvent } from "react";
import type { MediaSource } from "@reel-studio/shared-types";
import { AudioGlyphIcon, CloseIcon, VideoGlyphIcon } from "./icons.js";

interface MediaPickerModalProps {
  title: string;
  hint?: string;
  candidates: MediaSource[];
  onChoose: (sourceId: string) => void;
  onClose: () => void;
}

export function MediaPickerModal({ title, hint, candidates, onChoose, onClose }: MediaPickerModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  return (
    <div className="export-overlay media-picker-overlay" onClick={onClose}>
      <div className="export-panel media-picker-panel" onClick={stopPropagation}>
        <button type="button" className="export-close" onClick={onClose} title="Close">
          <CloseIcon />
        </button>
        <h2>{title}</h2>
        {hint && <p className="hint">{hint}</p>}
        {candidates.length === 0 ? (
          <p className="hint">Nothing to choose from yet — import media in the left panel first.</p>
        ) : (
          <div className="media-picker-grid">
            {candidates.map((source) => (
              <button
                key={source.id}
                type="button"
                className="media-picker-item"
                onClick={() => onChoose(source.id)}
                title={source.name}
              >
                <span className="media-picker-thumb">
                  {source.kind === "image" ? (
                    <img src={source.previewUrl} alt="" draggable={false} />
                  ) : source.kind === "video" ? (
                    <VideoGlyphIcon />
                  ) : (
                    <AudioGlyphIcon />
                  )}
                </span>
                <span className="media-picker-name">{source.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
