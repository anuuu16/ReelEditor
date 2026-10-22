import type { ProjectModel } from "@reel-studio/shared-types";
import { loadMediaBlob, loadProject, saveProject } from "./db.js";

// The editor autosaves twice: a snapshot into IndexedDB within a second of every edit, and the
// real save into ~/ReelStudioProjects a few seconds later (it re-uploads the media, so it's
// debounced longer). A reload in that window used to come back with the server's older copy and
// lose the last edits — /editor/:id always re-fetched from the server. Now the local snapshot is
// stamped with when it was taken, and whoever opens a project compares the two and keeps the
// fresher one; a restored-from-local project is then pushed to the server by the next autosave.

/** Writes the snapshot, stamped so it can be compared with the server's copy later. */
export async function saveLocalSnapshot(project: ProjectModel): Promise<void> {
  await saveProject({ ...project, metadata: { ...project.metadata, updatedAt: Date.now() } });
}

/** A saved project's sources point at blobs in IndexedDB; give each a URL the player can use. */
export async function hydrateSources(project: ProjectModel): Promise<ProjectModel> {
  const sources = await Promise.all(
    project.sources.map(async (source) => {
      if (source.isPlaceholder || source.origin) return source;
      const blob = await loadMediaBlob(source.id);
      if (!blob) {
        console.warn(`Missing stored media for "${source.name}" — re-import it to restore this clip.`);
        return { ...source, previewUrl: "" };
      }
      return { ...source, previewUrl: URL.createObjectURL(blob) };
    }),
  );
  return { ...project, sources };
}

/**
 * The project to open: the local snapshot when it's the same project and was taken after the
 * candidate (the server's copy, or the one handed over by the Dashboard) was last saved — or when
 * there is no candidate at all (a project reloaded before its first save ever reached the server).
 * Otherwise the candidate, untouched.
 */
export async function pickFreshestProject(projectId: string, candidate: ProjectModel | null): Promise<ProjectModel | null> {
  let local: ProjectModel | null = null;
  try {
    local = await loadProject();
  } catch (err) {
    console.warn("Couldn't read the local autosave snapshot", err);
  }
  if (!local || local.id !== projectId) return candidate;
  if (candidate && (candidate.metadata.updatedAt ?? 0) >= (local.metadata.updatedAt ?? 0)) return candidate;
  return hydrateSources(local);
}
