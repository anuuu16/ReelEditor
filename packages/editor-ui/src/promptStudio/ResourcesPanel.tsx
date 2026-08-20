import { useState } from "react";
import { ResourceList } from "./ResourceList.js";
import { ResourceUploader } from "./ResourceUploader.js";
import type { StudioProject, StudioResource, StudioResourceKind } from "./types.js";

interface ResourcesPanelProps {
  project: StudioProject;
  onUploaded: (resource: StudioResource) => void;
  onChanged: (resources: StudioResource[]) => void;
}

interface SubTab {
  id: string;
  label: string;
  kinds: StudioResourceKind[];
}

const SUB_TABS: SubTab[] = [
  { id: "video", label: "Scene videos", kinds: ["sceneVideo"] },
  { id: "audio", label: "Scene audio", kinds: ["sceneAudio"] },
  { id: "branding", label: "Covers & branding", kinds: ["cover", "logo", "banner", "character"] },
  { id: "final", label: "Final exports", kinds: ["finalExport"] },
  { id: "other", label: "Other", kinds: ["other"] },
];

// Splitting the flat resource uploader/list into sub-tabs by kind group keeps each screen focused
// (one drop zone at a time) instead of stacking all 8 kinds' worth of upload zones and grids at once.
export function ResourcesPanel({ project, onUploaded, onChanged }: ResourcesPanelProps) {
  const [subTab, setSubTab] = useState(SUB_TABS[0].id);
  const active = SUB_TABS.find((t) => t.id === subTab) ?? SUB_TABS[0];

  function countFor(kinds: StudioResourceKind[]): number {
    return project.resources.filter((r) => kinds.includes(r.kind)).length;
  }

  return (
    <section className="prompt-studio-section">
      <h2>Resources</h2>
      <p className="hint">Cover, logo, banner, character references, generated scene clips/audio, and finished exports.</p>

      <div className="prompt-studio-subtabs">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`prompt-studio-subtab${subTab === tab.id ? " active" : ""}`}
            onClick={() => setSubTab(tab.id)}
          >
            {tab.label}
            {countFor(tab.kinds) > 0 && <span className="prompt-studio-subtab-count">{countFor(tab.kinds)}</span>}
          </button>
        ))}
      </div>

      <ResourceUploader project={project} onUploaded={onUploaded} allowedKinds={active.kinds} />
      <ResourceList project={project} onChanged={onChanged} allowedKinds={active.kinds} />
    </section>
  );
}
