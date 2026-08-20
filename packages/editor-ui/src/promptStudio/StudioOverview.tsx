import { studioResourceUrl } from "./api.js";
import { accountsNeeded } from "./creditMath.js";
import { MetadataGenerator } from "./MetadataGenerator.js";
import { RESOURCE_KINDS } from "./resourceKinds.js";
import type { StudioProject, StudioResource } from "./types.js";

interface StudioOverviewProps {
  project: StudioProject;
  onNavigate: (tab: "content" | "prompts" | "scenes" | "resources" | "editors") => void;
  onProjectUpdated: (project: StudioProject) => void;
}

function ResourceThumb({ studioId, resource }: { studioId: string; resource: StudioResource }) {
  const url = studioResourceUrl(studioId, resource.id);
  if (resource.kind === "sceneAudio") {
    return <div className="prompt-studio-overview-thumb prompt-studio-overview-thumb-audio">audio</div>;
  }
  if (resource.kind === "sceneVideo" || resource.kind === "finalExport") {
    return <video className="prompt-studio-overview-thumb" src={url} muted />;
  }
  return <img className="prompt-studio-overview-thumb" src={url} alt={resource.filename} />;
}

export function StudioOverview({ project, onNavigate, onProjectUpdated }: StudioOverviewProps) {
  const cover = project.resources.find((r) => r.kind === "cover");
  const writtenScenes = project.scenes.filter((s) => s.prompt.trim().length > 0).length;
  const languagesWithPoem = project.languages.filter((l) => (project.poem[l] ?? "").trim().length > 0).length;
  const needed = project.scenes.length > 0 ? accountsNeeded(project.scenes.length, project.creditsPerAccount, project.creditsPerClip) : 0;
  const previewScenes = [...project.scenes].sort((a, b) => a.n - b.n).slice(0, 5);

  return (
    <div className="prompt-studio-overview">
      <div className="prompt-studio-overview-top">
        <div className="prompt-studio-overview-cover">
          {cover ? (
            <img src={studioResourceUrl(project.id, cover.id)} alt="Cover" />
          ) : (
            <button type="button" className="prompt-studio-overview-cover-placeholder" onClick={() => onNavigate("resources")}>
              + Add a cover
            </button>
          )}
        </div>

        <div className="prompt-studio-overview-stats">
          <div className="prompt-studio-stat">
            <span className="prompt-studio-stat-value">{project.scenes.length}</span>
            <span className="prompt-studio-stat-label">scenes ({writtenScenes} written)</span>
          </div>
          <div className="prompt-studio-stat">
            <span className="prompt-studio-stat-value">{project.languages.length}</span>
            <span className="prompt-studio-stat-label">languages ({languagesWithPoem} with content)</span>
          </div>
          <div className="prompt-studio-stat">
            <span className="prompt-studio-stat-value">{project.resources.length}</span>
            <span className="prompt-studio-stat-label">resources uploaded</span>
          </div>
          <div className="prompt-studio-stat">
            <span className="prompt-studio-stat-value">{project.editorProjects.length}</span>
            <span className="prompt-studio-stat-label">editor project{project.editorProjects.length === 1 ? "" : "s"} launched</span>
          </div>
          {needed > 0 && (
            <div className="prompt-studio-stat">
              <span className="prompt-studio-stat-value">{needed}</span>
              <span className="prompt-studio-stat-label">Flow account{needed === 1 ? "" : "s"} needed</span>
            </div>
          )}
        </div>
      </div>

      <div className="prompt-studio-overview-actions">
        <button type="button" onClick={() => onNavigate("content")}>
          Write / edit poem
        </button>
        <button type="button" onClick={() => onNavigate("prompts")}>
          Generate or paste prompts
        </button>
        <button type="button" onClick={() => onNavigate("scenes")}>
          Edit scenes
        </button>
        <button type="button" onClick={() => onNavigate("resources")}>
          Upload resources
        </button>
        <button type="button" onClick={() => onNavigate("editors")}>
          Launch / open an editor project
        </button>
      </div>

      {project.masterPrompt && (
        <div className="prompt-studio-overview-block">
          <h3>Master prompt</h3>
          <p className="prompt-studio-overview-excerpt">
            {project.masterPrompt.length > 320 ? `${project.masterPrompt.slice(0, 320)}...` : project.masterPrompt}
          </p>
        </div>
      )}

      <div className="prompt-studio-overview-block">
        <div className="prompt-studio-overview-block-header">
          <h3>Scenes</h3>
          {project.scenes.length > 0 && (
            <button type="button" className="prompt-studio-overview-see-all" onClick={() => onNavigate("scenes")}>
              See all {project.scenes.length}
            </button>
          )}
        </div>
        {previewScenes.length === 0 ? (
          <p className="hint">No scenes yet. Generate, paste JSON, or add one by hand.</p>
        ) : (
          <ul className="prompt-studio-overview-scene-list">
            {previewScenes.map((scene) => (
              <li key={scene.n}>
                <span className="prompt-studio-overview-scene-n">{scene.clipName}</span>
                <span className="prompt-studio-overview-scene-title">{scene.title || "(untitled)"}</span>
                <span className="prompt-studio-overview-scene-status">{scene.prompt.trim() ? "written" : "empty"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="prompt-studio-overview-block">
        <div className="prompt-studio-overview-block-header">
          <h3>Resources</h3>
          {project.resources.length > 0 && (
            <button type="button" className="prompt-studio-overview-see-all" onClick={() => onNavigate("resources")}>
              See all {project.resources.length}
            </button>
          )}
        </div>
        {project.resources.length === 0 ? (
          <p className="hint">Nothing uploaded yet.</p>
        ) : (
          RESOURCE_KINDS.map((section) => {
            const items = project.resources.filter((r) => r.kind === section.kind);
            if (items.length === 0) return null;
            return (
              <div key={section.kind} className="prompt-studio-overview-resource-row">
                <span className="prompt-studio-overview-resource-row-label">
                  {section.label} <span className="prompt-studio-char-count">({items.length})</span>
                </span>
                <div className="prompt-studio-overview-thumb-strip">
                  {items.map((r) => (
                    <ResourceThumb key={r.id} studioId={project.id} resource={r} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="prompt-studio-overview-block">
        <h3>Title, description, hashtags</h3>
        <MetadataGenerator project={project} onProjectUpdated={onProjectUpdated} />
      </div>

      {project.languages.length > 0 && (
        <div className="prompt-studio-overview-block">
          <h3>Editor projects</h3>
          <ul className="prompt-studio-overview-editor-list">
            {project.languages.map((language) => {
              const link = project.editorProjects.find((l) => l.language === language);
              return (
                <li key={language}>
                  <span>{language}</span>
                  <span>{link ? "Launched" : "Not launched yet"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
