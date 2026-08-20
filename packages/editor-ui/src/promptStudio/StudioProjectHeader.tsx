import { useEffect, useState } from "react";
import { ASPECT_RATIO_PRESETS } from "@reel-studio/timeline-core";
import { creditsPerClipForModel } from "./creditMath.js";
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
  // Kept as text while a field is being edited so clearing it to type a new value doesn't force
  // it to "0" mid-edit — only parsed to a number when it's actually saved (on blur).
  const [creditsPerClipText, setCreditsPerClipText] = useState(String(project.creditsPerClip));
  const [creditsPerAccountText, setCreditsPerAccountText] = useState(String(project.creditsPerAccount));

  useEffect(() => {
    setTitle(project.title);
    setPlatform(project.platform ?? "");
    setStyle(project.style ?? "");
    setModel(project.model);
    setCreditsPerClipText(String(project.creditsPerClip));
    setCreditsPerAccountText(String(project.creditsPerAccount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  function commitCreditsPerClip() {
    const parsed = Number(creditsPerClipText);
    const next = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : project.creditsPerClip;
    setCreditsPerClipText(String(next));
    if (next !== project.creditsPerClip) onPatch({ creditsPerClip: next });
  }

  function commitCreditsPerAccount() {
    const parsed = Number(creditsPerAccountText);
    const next = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : project.creditsPerAccount;
    setCreditsPerAccountText(String(next));
    if (next !== project.creditsPerAccount) onPatch({ creditsPerAccount: next });
  }

  // Changing the model still fills in its usual credits-per-clip as a sensible default, but the
  // field stays freely editable afterward for accounts that price differently.
  function handleModelChange(nextModel: string) {
    setModel(nextModel);
    const defaultCredits = creditsPerClipForModel(nextModel);
    setCreditsPerClipText(String(defaultCredits));
    onPatch({ model: nextModel, creditsPerClip: defaultCredits });
  }

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
          <select value={model} onChange={(e) => handleModelChange(e.target.value)}>
            <option value="Veo 3.1 Lite">Veo 3.1 Lite</option>
            <option value="Veo 3.1 Fast">Veo 3.1 Fast</option>
            <option value="Veo 3.1 Quality">Veo 3.1 Quality</option>
          </select>
        </label>

        <label className="field">
          <span>Credits per clip</span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={creditsPerClipText}
            onChange={(e) => setCreditsPerClipText(e.target.value)}
            onBlur={commitCreditsPerClip}
          />
        </label>

        <label className="field">
          <span>Credits per account</span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={creditsPerAccountText}
            onChange={(e) => setCreditsPerAccountText(e.target.value)}
            onBlur={commitCreditsPerAccount}
          />
        </label>
      </div>

      {project.namingConvention && <p className="hint">Clip naming: {project.namingConvention}</p>}
    </header>
  );
}
