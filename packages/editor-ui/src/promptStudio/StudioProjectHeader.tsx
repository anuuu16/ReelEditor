import { useEffect, useState } from "react";
import { ASPECT_RATIO_PRESETS } from "@reel-studio/timeline-core";
import type { StudioProject } from "./types.js";

interface StudioProjectHeaderProps {
  project: StudioProject;
  onPatch: (patch: Partial<StudioProject>) => void;
}

const VIDEO_TYPES: Array<{ id: StudioProject["videoType"]; label: string }> = [
  { id: "reel", label: "Reel (vertical)" },
  { id: "full_video", label: "Full video (landscape)" },
];

export function StudioProjectHeader({ project, onPatch }: StudioProjectHeaderProps) {
  const [title, setTitle] = useState(project.title);
  const [platform, setPlatform] = useState(project.platform ?? "");
  const [style, setStyle] = useState(project.style ?? "");
  const [model, setModel] = useState(project.model);
  const [creditsPerClip, setCreditsPerClip] = useState(project.creditsPerClip);
  const [creditsPerAccount, setCreditsPerAccount] = useState(project.creditsPerAccount);

  useEffect(() => {
    setTitle(project.title);
    setPlatform(project.platform ?? "");
    setStyle(project.style ?? "");
    setModel(project.model);
    setCreditsPerClip(project.creditsPerClip);
    setCreditsPerAccount(project.creditsPerAccount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  return (
    <header className="prompt-studio-header">
      <input
        className="prompt-studio-title-input"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== project.title && onPatch({ title: title.trim() })}
      />

      <div className="inline-fields prompt-studio-header-row">
        <label className="field">
          <span>Video type</span>
          <select
            value={project.videoType}
            onChange={(e) => onPatch({ videoType: e.target.value as StudioProject["videoType"] })}
          >
            {VIDEO_TYPES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Aspect ratio</span>
          <select value={project.aspectRatio} onChange={(e) => onPatch({ aspectRatio: e.target.value })}>
            {ASPECT_RATIO_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Platform</span>
          <input
            type="text"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            onBlur={() => onPatch({ platform })}
            placeholder="Instagram Reels"
          />
        </label>

        <label className="field">
          <span>Style</span>
          <input
            type="text"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            onBlur={() => onPatch({ style })}
            placeholder="cinematic, warm film grade"
          />
        </label>
      </div>

      <div className="inline-fields prompt-studio-header-row">
        <label className="field">
          <span>Model</span>
          <select value={model} onChange={(e) => { setModel(e.target.value); onPatch({ model: e.target.value }); }}>
            <option value="Veo 3.1 Lite">Veo 3.1 Lite</option>
            <option value="Veo 3.1 Fast">Veo 3.1 Fast</option>
            <option value="Veo 3.1 Quality">Veo 3.1 Quality</option>
          </select>
        </label>

        <label className="field">
          <span>Credits per clip</span>
          <input
            type="number"
            min={0}
            value={creditsPerClip}
            onChange={(e) => setCreditsPerClip(Number(e.target.value))}
            onBlur={() => onPatch({ creditsPerClip })}
          />
        </label>

        <label className="field">
          <span>Credits per account</span>
          <input
            type="number"
            min={0}
            value={creditsPerAccount}
            onChange={(e) => setCreditsPerAccount(Number(e.target.value))}
            onBlur={() => onPatch({ creditsPerAccount })}
          />
        </label>
      </div>

      {project.namingConvention && <p className="hint">Clip naming: {project.namingConvention}</p>}
    </header>
  );
}
