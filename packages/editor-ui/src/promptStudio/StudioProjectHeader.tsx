import { useEffect, useState } from "react";
import { ASPECT_RATIO_PRESETS } from "@reel-studio/timeline-core";
import { creditsPerClipForModel } from "./creditMath.js";
import type { StudioProject } from "./types.js";
import { NumberField, SelectField, TextField } from "./ui/index.js";

interface StudioProjectHeaderProps {
  project: StudioProject;
  onPatch: (patch: Partial<StudioProject>) => void;
}

const VIDEO_TYPES: Array<{ id: StudioProject["videoType"]; label: string }> = [
  { id: "reel", label: "Reel (vertical)" },
  { id: "full_video", label: "Full video (landscape)" },
];

const MODEL_OPTIONS = [
  { value: "Veo 3.1 Lite", label: "Veo 3.1 Lite" },
  { value: "Veo 3.1 Fast", label: "Veo 3.1 Fast" },
  { value: "Veo 3.1 Quality", label: "Veo 3.1 Quality" },
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

  const totalLengthSeconds = project.totalLengthSeconds ?? 32;
  const clipLengthSeconds = project.clipLengthSeconds ?? 8;
  const clipCount = Math.max(1, Math.round(totalLengthSeconds / clipLengthSeconds));

  useEffect(() => {
    setTitle(project.title);
    setPlatform(project.platform ?? "");
    setStyle(project.style ?? "");
    setModel(project.model);
    setCreditsPerClipText(String(project.creditsPerClip));
    setCreditsPerAccountText(String(project.creditsPerAccount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

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
      {/* This title input is a heading, not a labeled form field (no visible label sits above
          it), so it stays a plain input rather than TextField — but it still only uses ps-*
          tokens, no hardcoded colors. */}
      <input
        className="w-full rounded-ps border border-transparent bg-transparent px-1.5 py-1 text-lg font-semibold text-ps-text hover:border-ps-border hover:bg-ps-elevated focus:border-ps-border focus:bg-ps-elevated focus:outline-none"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== project.title && onPatch({ title: title.trim() })}
      />

      <div className="mb-3.5 flex flex-wrap gap-3">
        <SelectField
          label="Video type"
          value={project.videoType}
          onChange={(value) => onPatch({ videoType: value as StudioProject["videoType"] })}
          options={VIDEO_TYPES.map((v) => ({ value: v.id, label: v.label }))}
          className="min-w-[160px] flex-1"
        />

        <SelectField
          label="Aspect ratio"
          value={project.aspectRatio}
          onChange={(value) => onPatch({ aspectRatio: value })}
          options={ASPECT_RATIO_PRESETS.map((p) => ({ value: p.id, label: p.id }))}
          className="min-w-[140px] flex-1"
        />

        <TextField
          label="Platform"
          value={platform}
          onChange={setPlatform}
          onBlur={() => onPatch({ platform })}
          placeholder="Instagram Reels"
          className="min-w-[180px] flex-1"
        />

        <TextField
          label="Style"
          value={style}
          onChange={setStyle}
          onBlur={() => onPatch({ style })}
          placeholder="cinematic, warm film grade"
          className="min-w-[180px] flex-1"
        />
      </div>

      <div className="mb-3.5 flex flex-wrap items-end gap-3">
        <NumberField
          label="Total video length (seconds)"
          value={totalLengthSeconds}
          onChange={(n) => onPatch({ totalLengthSeconds: n })}
          min={1}
          className="min-w-[180px] flex-1"
        />

        <NumberField
          label="Clip length (seconds, Veo model)"
          value={clipLengthSeconds}
          onChange={(n) => onPatch({ clipLengthSeconds: n })}
          min={1}
          className="min-w-[180px] flex-1"
        />

        <p className="text-xs text-ps-muted">≈ {clipCount} clip{clipCount === 1 ? "" : "s"}</p>
      </div>

      <div className="mb-3.5 flex flex-wrap gap-3">
        <SelectField label="Model" value={model} onChange={handleModelChange} options={MODEL_OPTIONS} className="min-w-[160px] flex-1" />

        <NumberField
          label="Credits per clip"
          value={Number(creditsPerClipText) || 0}
          onChange={(n) => {
            setCreditsPerClipText(String(n));
            if (n !== project.creditsPerClip) onPatch({ creditsPerClip: n });
          }}
          min={1}
          className="min-w-[140px] flex-1"
        />

        <NumberField
          label="Credits per account"
          value={Number(creditsPerAccountText) || 0}
          onChange={(n) => {
            setCreditsPerAccountText(String(n));
            if (n !== project.creditsPerAccount) onPatch({ creditsPerAccount: n });
          }}
          min={1}
          className="min-w-[140px] flex-1"
        />
      </div>

      {project.namingConvention && <p className="text-xs text-ps-muted">Clip naming: {project.namingConvention}</p>}
    </header>
  );
}
