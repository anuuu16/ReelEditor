import { useEffect, useState } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import { getStudioProject, patchStudioProject } from "./api.js";
import { JsonImportExport } from "./JsonImportExport.js";
import { LaunchEditorPanel } from "./LaunchEditorPanel.js";
import { PoemEditor } from "./PoemEditor.js";
import { PromptGenerator } from "./PromptGenerator.js";
import { ResourcesPanel } from "./ResourcesPanel.js";
import { RhymeStudioView } from "./RhymeStudioView.js";
import { ScenePromptsList } from "./ScenePromptsList.js";
import { StudioOverview } from "./StudioOverview.js";
import { StudioProjectHeader } from "./StudioProjectHeader.js";
import type { StudioEditorProjectLink, StudioProject, StudioResource } from "./types.js";
import { ThemeToggle, usePromptStudioTheme } from "./ui/index.js";

export type DetailTab = "overview" | "settings" | "content" | "prompts" | "rhyme" | "scenes" | "resources" | "editors";

export const DETAIL_TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "settings", label: "Settings" },
  { id: "content", label: "Written content" },
  { id: "prompts", label: "AI prompts" },
  { id: "rhyme", label: "Rhyme Studio" },
  { id: "scenes", label: "Scenes" },
  { id: "resources", label: "Resources" },
  { id: "editors", label: "Editor projects" },
];

function isDetailTab(value: string | undefined): value is DetailTab {
  return !!value && DETAIL_TABS.some((t) => t.id === value);
}

interface PromptStudioViewProps {
  studioId: string;
  /** Raw route param — validated/defaulted to "overview" here, since a URL segment can be anything. */
  activeTab: string | undefined;
  onTabChange: (tab: DetailTab) => void;
  onBack: () => void;
  onOpenProject: (project: ProjectModel) => void;
}

// One open Studio project's detail view: a side nav of tabs, each tab a distinct URL
// (/prompt-studio/:studioId/:tab) so every section is bookmarkable and survives a refresh.
export function PromptStudioView({ studioId, activeTab: rawTab, onTabChange, onBack, onOpenProject }: PromptStudioViewProps) {
  const activeTab: DetailTab = isDetailTab(rawTab) ? rawTab : "overview";
  const [theme, toggleTheme] = usePromptStudioTheme();

  const [project, setProject] = useState<StudioProject | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    setDetailError(null);
    getStudioProject(studioId)
      .then(setProject)
      .catch((err) => setDetailError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsLoading(false));
  }, [studioId]);

  async function patchProject(patch: Partial<StudioProject>) {
    if (!project) return;
    try {
      const updated = await patchStudioProject(project.id, patch);
      setProject(updated);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
    }
  }

  function applyLocalUpdate(patch: Partial<StudioProject>) {
    setProject((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function refreshProject() {
    if (!project) return;
    const fresh = await getStudioProject(project.id);
    setProject(fresh);
  }

  function handleResourceUploaded(resource: StudioResource) {
    setProject((prev) => (prev ? { ...prev, resources: [...prev.resources, resource] } : prev));
  }

  function handleResourcesChanged(resources: StudioResource[]) {
    setProject((prev) => (prev ? { ...prev, resources } : prev));
  }

  function handleLinkAdded(link: StudioEditorProjectLink) {
    setProject((prev) =>
      prev
        ? { ...prev, editorProjects: [...prev.editorProjects.filter((l) => l.language !== link.language), link] }
        : prev
    );
  }

  if (isLoading) {
    return (
      <div className="prompt-studio" data-theme={theme}>
        <p className="hint">Loading...</p>
      </div>
    );
  }

  if (detailError || !project) {
    return (
      <div className="prompt-studio" data-theme={theme}>
        <p className="export-error">{detailError ?? "Studio project not found"}</p>
        <button type="button" onClick={onBack}>
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="prompt-studio" data-theme={theme}>
      <header className="dashboard-header">
        <h1>{project.title}</h1>
        <div className="inline-fields">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <button type="button" onClick={onBack}>
            Back to dashboard
          </button>
        </div>
      </header>

      <div className="prompt-studio-layout">
        <nav className="prompt-studio-sidenav">
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="prompt-studio-main">
          {activeTab === "overview" && <StudioOverview project={project} onNavigate={onTabChange} onProjectUpdated={setProject} />}

          {activeTab === "settings" && <StudioProjectHeader project={project} onPatch={patchProject} />}

          {activeTab === "content" && <PoemEditor project={project} onPatch={patchProject} />}

          {activeTab === "prompts" && (
            <>
              <PromptGenerator project={project} onPatch={patchProject} onLocalUpdate={applyLocalUpdate} onRefresh={refreshProject} />
              <JsonImportExport project={project} onPatch={patchProject} />
            </>
          )}

          {activeTab === "rhyme" && <RhymeStudioView project={project} onPatch={patchProject} onOpenProject={onOpenProject} />}

          {activeTab === "scenes" && <ScenePromptsList project={project} onPatch={patchProject} />}

          {activeTab === "resources" && (
            <ResourcesPanel project={project} onUploaded={handleResourceUploaded} onChanged={handleResourcesChanged} />
          )}

          {activeTab === "editors" && (
            <LaunchEditorPanel project={project} onLinkAdded={handleLinkAdded} onOpenProject={onOpenProject} />
          )}
        </div>
      </div>
    </div>
  );
}
