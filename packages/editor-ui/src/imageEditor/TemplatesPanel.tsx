import { useEffect, useState } from "react";
import { applyTemplateConfig, createDefaultDocument } from "./document.js";
import { createPlaceholderMedia, renderThumbnail } from "./renderImage.js";
import type { ImageTemplate } from "./templates.js";

interface TemplatesPanelProps {
  builtIn: ImageTemplate[];
  saved: ImageTemplate[];
  hasPhoto: boolean;
  onApply: (template: ImageTemplate) => void;
  onSaveCurrent: (name: string) => void;
  onDelete: (template: ImageTemplate) => void;
}

// Built-in templates ship without thumbnails; they're rendered once here over a gradient stand-in
// photo, which doubles as a hint that the template is a look to put YOUR photo into.
function useBuiltInThumbnails(templates: ImageTemplate[]): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    const placeholder = createPlaceholderMedia("placeholder");
    const media = { placeholder };
    const next: Record<string, string> = {};
    for (const template of templates) {
      try {
        const doc = applyTemplateConfig({ ...createDefaultDocument(), sourceMediaId: "placeholder" }, template.config);
        next[template.id] = renderThumbnail(doc, media, 240);
      } catch (err) {
        console.error("Template thumbnail failed", err);
      }
    }
    setThumbs(next);
  }, [templates]);
  return thumbs;
}

export function TemplatesPanel({ builtIn, saved, hasPhoto, onApply, onSaveCurrent, onDelete }: TemplatesPanelProps) {
  const builtInThumbs = useBuiltInThumbnails(builtIn);
  const [name, setName] = useState("");

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSaveCurrent(trimmed);
    setName("");
  }

  function card(template: ImageTemplate) {
    const thumb = template.thumbnailDataUrl ?? builtInThumbs[template.id];
    return (
      <figure key={template.id} className="ie-template-card" title={template.description}>
        <button type="button" className="ie-template-thumb" onClick={() => onApply(template)} title={`Apply "${template.name}"`}>
          {thumb ? <img src={thumb} alt="" /> : <span />}
        </button>
        <figcaption>
          <span className="project-list-name">{template.name}</span>
          <span className="project-list-meta">
            {template.config.canvas.width}×{template.config.canvas.height}
            {template.config.layers.length > 0 &&
              ` · ${template.config.layers.length} layer${template.config.layers.length === 1 ? "" : "s"}`}
          </span>
        </figcaption>
        <div className="inline-fields">
          <button type="button" onClick={() => onApply(template)}>
            Apply
          </button>
          {!template.builtIn && (
            <button type="button" className="project-delete-button" onClick={() => onDelete(template)}>
              Delete
            </button>
          )}
        </div>
      </figure>
    );
  }

  return (
    <>
      <p className="hint">
        A template is a saved look — size, background, adjustments, frame, watermark and layers. Applying one keeps your photo (and its
        crop) and restyles everything around it.
      </p>
      <div className="ie-template-grid">{builtIn.map(card)}</div>

      <div className="field">
        <span>Save the current look as a template</span>
        <div className="inline-fields">
          <input
            type="text"
            value={name}
            placeholder="Template name"
            className="ie-template-name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
          />
          <button type="button" onClick={handleSave} disabled={!name.trim()}>
            Save
          </button>
        </div>
        {!hasPhoto && <p className="hint">Tip: load a photo first so the template's thumbnail shows the real result.</p>}
      </div>

      {saved.length > 0 && (
        <>
          <span className="ie-subheading">Your templates</span>
          <div className="ie-template-grid">{saved.map(card)}</div>
        </>
      )}
    </>
  );
}
