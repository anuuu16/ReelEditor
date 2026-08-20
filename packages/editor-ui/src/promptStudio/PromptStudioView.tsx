import { useCallback, useEffect, useState } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import { createStudioProject, deleteStudioProject, getStudioProject, listStudioProjects, patchStudioProject } from "./api.js";
import { LaunchEditorPanel } from "./LaunchEditorPanel.js";
import { PoemEditor } from "./PoemEditor.js";
import { PromptGenerator } from "./PromptGenerator.js";
import { ResourceList } from "./ResourceList.js";
import { ResourceUploader } from "./ResourceUploader.js";
import { ScenePromptsList } from "./ScenePromptsList.js";
import { StudioProjectHeader } from "./StudioProjectHeader.js";
import type { StudioEditorProjectLink, StudioProject, StudioProjectSummary, StudioResource } from "./types.js";

interface PromptStudioViewProps {
  onBack: () => void;
  onOpenProject: (project: ProjectModel) => void;
}

function formatSummaryMeta(s: StudioProjectSummary): string {
  const languages = s.languages.length ? s.languages.join(", ") : "no languages yet";
  return `${languages} · ${s.sceneCount} scene${s.sceneCount === 1 ? "" : "s"} · ${s.resourceCount} resource${s.resourceCount === 1 ? "" : "s"} · ${s.editorProjectCount} editor project${s.editorProjectCount === 1 ? "" : "s"}`;
}

// The top-level Prompt Studio screen: a tiny router between a list of Studio projects and one
// open project's detail view, which composes every editing panel for that project.
export function PromptStudioView({ onBack, onOpenProject }: PromptStudioViewProps) {
  const [summaries, setSummaries] = useState<StudioProjectSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [project, setProject] = useState<StudioProject | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const refreshList = useCallback(() => {
    listStudioProjects()
      .then(setSummaries)
      .catch((err) => setListError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  async function handleOpenSummary(id: string) {
    setIsLoadingDetail(true);
    setDetailError(null);
    try {
      const full = await getStudioProject(id);
      setProject(full);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingDetail(false);
    }
  }

  async function handleCreate() {
    setIsCreating(true);
    setListError(null);
    try {
      const created = await createStudioProject({});
      setProject(created);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDeleteSummary(id: string, title: string) {
    if (!window.confirm(`Delete "${title}"? This removes its poem, prompts, and every uploaded resource.`)) return;
    try {
      await deleteStudioProject(id);
      refreshList();
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleBackToList() {
    setProject(null);
    setDetailError(null);
    refreshList();
  }

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

  if (!project) {
    return (
      <div className="prompt-studio">
        <header className="dashboard-header">
          <h1>Prompt Studio</h1>
          <div className="inline-fields">
            <button type="button" onClick={onBack}>
              Back to dashboard
            </button>
          </div>
        </header>

        <div className="prompt-studio-body">
          <div className="dashboard-hero">
            <button type="button" className="dashboard-new-project" onClick={handleCreate} disabled={isCreating}>
              {isCreating ? "Creating..." : "+ New project"}
            </button>
            <p className="hint">
              One project holds the poem, the master and scene prompts, every uploaded resource, and a link to each
              language's editor timeline.
            </p>
          </div>

          {listError && <p className="export-error">{listError}</p>}

          <ul className="project-list">
            {summaries.length === 0 && <p className="hint">No Studio projects yet. Start one above.</p>}
            {summaries.map((s) => (
              <li key={s.id} className="project-list-item">
                <div className="project-list-info">
                  <span className="project-list-name">{s.title}</span>
                  <span className="project-list-meta">{formatSummaryMeta(s)}</span>
                </div>
                <button type="button" disabled={isLoadingDetail} onClick={() => handleOpenSummary(s.id)}>
                  {isLoadingDetail ? "Opening..." : "Open"}
                </button>
                <button type="button" className="project-delete-button" onClick={() => handleDeleteSummary(s.id, s.title)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="prompt-studio">
      <header className="dashboard-header">
        <h1>Prompt Studio</h1>
        <div className="inline-fields">
          <button type="button" onClick={handleBackToList}>
            All Studio projects
          </button>
          <button type="button" onClick={onBack}>
            Back to dashboard
          </button>
        </div>
      </header>

      <div className="prompt-studio-body">
        {detailError && <p className="export-error">{detailError}</p>}

        <StudioProjectHeader project={project} onPatch={patchProject} />
        <PoemEditor project={project} onPatch={patchProject} />
        <PromptGenerator project={project} onPatch={patchProject} onLocalUpdate={applyLocalUpdate} onRefresh={refreshProject} />
        <ScenePromptsList project={project} onPatch={patchProject} />

        <section className="prompt-studio-section">
          <h2>Resources</h2>
          <p className="hint">Cover, logo, banner, character references, generated scene clips/audio, and finished exports.</p>
          <ResourceUploader project={project} onUploaded={handleResourceUploaded} />
          <ResourceList project={project} onChanged={handleResourcesChanged} />
        </section>

        <LaunchEditorPanel project={project} onLinkAdded={handleLinkAdded} onOpenProject={onOpenProject} />
      </div>
    </div>
  );
}
