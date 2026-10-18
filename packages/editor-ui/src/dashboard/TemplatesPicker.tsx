import { useEffect, useState } from "react";
import { applyTemplateConfig, createDefaultDocument } from "../imageEditor/document.js";
import { createPlaceholderMedia, renderThumbnail } from "../imageEditor/renderImage.js";
import type { ImageTemplate } from "../imageEditor/templates.js";

interface TemplatesPickerProps {
  templates: ImageTemplate[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/** A selectable grid of templates; built-ins get a thumbnail rendered over a placeholder photo. */
export function TemplatesPicker({ templates, selectedId, onSelect }: TemplatesPickerProps) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    const media = { placeholder: createPlaceholderMedia("placeholder") };
    const next: Record<string, string> = {};
    for (const template of templates) {
      if (template.thumbnailDataUrl) continue;
      try {
        next[template.id] = renderThumbnail(
          applyTemplateConfig({ ...createDefaultDocument(), sourceMediaId: "placeholder" }, template.config),
          media,
          200,
        );
      } catch (err) {
        console.error("Template thumbnail failed", err);
      }
    }
    setThumbs(next);
  }, [templates]);

  return (
    <div className="template-picker">
      {templates.map((template) => {
        const thumb = template.thumbnailDataUrl ?? thumbs[template.id];
        return (
          <button
            key={template.id}
            type="button"
            className={`template-picker-card${selectedId === template.id ? " selected" : ""}`}
            onClick={() => onSelect(template.id)}
            title={template.description}
          >
            <span className="template-picker-thumb">{thumb && <img src={thumb} alt="" />}</span>
            <span className="project-list-name">{template.name}</span>
            <span className="project-list-meta">
              {template.config.canvas.width}×{template.config.canvas.height}
              {!template.builtIn && " · yours"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
