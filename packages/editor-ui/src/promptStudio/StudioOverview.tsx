import { studioResourceUrl } from "./api.js";
import { accountsNeeded } from "./creditMath.js";
import { MetadataGenerator } from "./MetadataGenerator.js";
import { RESOURCE_KINDS } from "./resourceKinds.js";
import { computeTiming, deriveScenesFromPoems } from "./rhymeTiming.js";
import type { StudioProject, StudioResource } from "./types.js";
import { Button } from "./ui/index.js";

interface StudioOverviewProps {
  project: StudioProject;
  onNavigate: (tab: "rhyme" | "resources" | "editors") => void;
  onProjectUpdated: (project: StudioProject) => void;
}

// Reads Rhyme Studio's poems (RhymePoemSlot[]) rather than the older flat project.poem/scenes/
// masterPrompt fields — those stay populated only for projects created before Rhyme Studio existed.
function poemSummary(project: StudioProject) {
  const slots = project.poems ?? [];
  let totalScenes = 0;
  let scenesWithPrompts = 0;
  const languagesWithContent = new Set<string>();
  let firstMaster: string | null = null;

  for (const slot of slots) {
    const version = slot.versions[slot.activeVersionIndex];
    const poem = version.poem;
    const sceneCount = computeTiming(poem.scenes.length ? poem.scenes : deriveScenesFromPoems(poem.poems, slot.params.scenes)).timed.length;
    totalScenes += sceneCount;

    const reels = Object.values(version.reels ?? {});
    if (reels.some((r) => r.scenePrompts.length > 0)) scenesWithPrompts += sceneCount;
    if (!firstMaster) firstMaster = reels.find((r) => r.master)?.master ?? null;

    for (const language of slot.params.languages) {
      if ((poem.poems[language] ?? "").trim()) languagesWithContent.add(language);
    }
  }

  return { slots, totalScenes, scenesWithPrompts, languagesWithContent, firstMaster };
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
  const { slots, totalScenes, scenesWithPrompts, languagesWithContent, firstMaster } = poemSummary(project);
  const needed = totalScenes > 0 ? accountsNeeded(totalScenes, project.creditsPerAccount, project.creditsPerClip) : 0;

  return (
    <div className="prompt-studio-overview">
      <div className="prompt-studio-overview-top">
        <div className="prompt-studio-overview-cover">
          {cover ? (
            <img src={studioResourceUrl(project.id, cover.id)} alt="Cover" />
          ) : (
            <button
              type="button"
              className="h-full w-full cursor-pointer border-none bg-transparent text-xs text-ps-muted hover:text-ps-text"
              onClick={() => onNavigate("resources")}
            >
              + Add a cover
            </button>
          )}
        </div>

        <div className="prompt-studio-overview-stats">
          <div className="prompt-studio-stat">
            <span className="prompt-studio-stat-value">{slots.length}</span>
            <span className="prompt-studio-stat-label">poem{slots.length === 1 ? "" : "s"}</span>
          </div>
          <div className="prompt-studio-stat">
            <span className="prompt-studio-stat-value">{totalScenes}</span>
            <span className="prompt-studio-stat-label">scenes ({scenesWithPrompts} with prompts)</span>
          </div>
          <div className="prompt-studio-stat">
            <span className="prompt-studio-stat-value">{project.languages.length}</span>
            <span className="prompt-studio-stat-label">languages ({languagesWithContent.size} with content)</span>
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
        <Button variant="primary" onClick={() => onNavigate("rhyme")}>
          Continue in Rhyme Studio →
        </Button>
        <Button onClick={() => onNavigate("resources")}>Upload resources</Button>
        <Button onClick={() => onNavigate("editors")}>Launch / open an editor project</Button>
      </div>

      {firstMaster && (
        <div className="prompt-studio-overview-block">
          <h3>Master prompt</h3>
          <p className="prompt-studio-overview-excerpt">{firstMaster.length > 320 ? `${firstMaster.slice(0, 320)}...` : firstMaster}</p>
        </div>
      )}

      <div className="prompt-studio-overview-block">
        <div className="prompt-studio-overview-block-header">
          <h3>Poems</h3>
          {slots.length > 0 && (
            <button
              type="button"
              className="cursor-pointer border-none bg-transparent p-0 text-xs text-ps-accent hover:underline"
              onClick={() => onNavigate("rhyme")}
            >
              Open Rhyme Studio
            </button>
          )}
        </div>
        {slots.length === 0 ? (
          <p className="text-xs text-ps-muted">No poems yet. Head to Rhyme Studio to set a concept and generate one.</p>
        ) : (
          <ul className="prompt-studio-overview-scene-list">
            {slots.map((slot) => {
              const version = slot.versions[slot.activeVersionIndex];
              const title = Object.values(version.poem.titles)[0] || "Untitled poem";
              const hasScenePrompts = Object.values(version.reels ?? {}).some((r) => r.scenePrompts.length > 0);
              return (
                <li key={slot.id}>
                  <span className="prompt-studio-overview-scene-n">{slot.params.languages.join(", ")}</span>
                  <span className="prompt-studio-overview-scene-title">{title}</span>
                  <span className="prompt-studio-overview-scene-status">{hasScenePrompts ? "scenes written" : "no scenes yet"}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="prompt-studio-overview-block">
        <div className="prompt-studio-overview-block-header">
          <h3>Resources</h3>
          {project.resources.length > 0 && (
            <button
              type="button"
              className="cursor-pointer border-none bg-transparent p-0 text-xs text-ps-accent hover:underline"
              onClick={() => onNavigate("resources")}
            >
              See all {project.resources.length}
            </button>
          )}
        </div>
        {project.resources.length === 0 ? (
          <p className="text-xs text-ps-muted">Nothing uploaded yet.</p>
        ) : (
          RESOURCE_KINDS.map((section) => {
            const items = project.resources.filter((r) => r.kind === section.kind);
            if (items.length === 0) return null;
            return (
              <div key={section.kind} className="prompt-studio-overview-resource-row">
                <span className="prompt-studio-overview-resource-row-label">
                  {section.label} <span className="text-ps-muted">({items.length})</span>
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
