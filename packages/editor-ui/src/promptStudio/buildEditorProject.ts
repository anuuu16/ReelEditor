import type { Clip, MediaSource, ProjectModel } from "@reel-studio/shared-types";
import { ASPECT_RATIO_PRESETS } from "@reel-studio/timeline-core";
import { AUDIO_TRACK_ID, OVERLAY_TRACK_ID, VIDEO_TRACK_ID } from "../state/initialProject.js";
import { studioResourceUrl } from "./api.js";
import type { StudioProject, StudioResource } from "./types.js";

interface MediaMetadata {
  durationSeconds: number;
  width: number;
  height: number;
}

// Mirrors media/importFile.ts's readMediaMetadata, but reads from an already-hosted URL (a Studio
// resource served by render-service) instead of a local File, since these clips already live on
// disk and must never be re-uploaded into this project's own media store.
function loadMediaMetadata(url: string, kind: "video" | "audio"): Promise<MediaMetadata> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind) as HTMLVideoElement;
    el.preload = "metadata";
    el.src = url;
    el.onloadedmetadata = () => {
      resolve({
        durationSeconds: el.duration,
        width: kind === "video" ? el.videoWidth : 0,
        height: kind === "video" ? el.videoHeight : 0,
      });
    };
    el.onerror = () => reject(new Error(`Failed to read metadata for ${url}`));
  });
}

function sortBySceneThenUpload(resources: StudioResource[]): StudioResource[] {
  return [...resources].sort((a, b) => {
    if (a.sceneN !== null && b.sceneN !== null) return a.sceneN - b.sceneN;
    if (a.sceneN !== null) return -1;
    if (b.sceneN !== null) return 1;
    return a.uploadedAt - b.uploadedAt;
  });
}

// Same Clip field defaults as the ADD_CLIP action in state/reducer.ts, kept in sync by hand since
// that reducer is off-limits to import from here.
function buildClip(trackId: string, source: MediaSource): Clip {
  return {
    id: crypto.randomUUID(),
    sourceId: source.id,
    trackId,
    label: "",
    inPoint: 0,
    outPoint: source.durationSeconds,
    timelineStart: 0,
    fitMode: "fit",
    transform: { scale: 1, x: 0, y: 0, rotation: 0 },
    volume: 1,
    muted: false,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
    speed: 1,
    opacity: 1,
    filter: { preset: null, brightness: 0, contrast: 1, saturation: 1, hue: 0 },
    transitionOutSeconds: 0,
    transitionOutType: "dissolve",
    gapBeforeSeconds: 0,
  };
}

async function buildSourceFromResource(
  studioProject: StudioProject,
  resource: StudioResource,
  kind: "video" | "audio"
): Promise<MediaSource> {
  const previewUrl = studioResourceUrl(studioProject.id, resource.id);
  const metadata = await loadMediaMetadata(previewUrl, kind);
  return {
    id: crypto.randomUUID(),
    name: resource.filename,
    filePath: "",
    previewUrl,
    durationSeconds: metadata.durationSeconds,
    width: metadata.width,
    height: metadata.height,
    kind,
    isPlaceholder: false,
    origin: { kind: "studio", studioProjectId: studioProject.id, resourceId: resource.id },
  };
}

/**
 * Builds a fresh editor ProjectModel for one language of a Studio project: one video-track clip
 * per `sceneVideo` resource (ordered by sceneN) and one audio-track clip per `sceneAudio` resource
 * matching this language (also ordered by sceneN, falling back to upload order). Every MediaSource
 * built here is `origin`-tagged so it always points at the Studio project's own shared resource
 * file rather than a private copy, so the same underlying scene video/audio is never duplicated on
 * disk across languages.
 */
export async function buildEditorProjectForLanguage(studioProject: StudioProject, language: string): Promise<ProjectModel> {
  const preset = ASPECT_RATIO_PRESETS.find((p) => p.id === studioProject.aspectRatio) ?? ASPECT_RATIO_PRESETS[0];

  const sceneVideoResources = sortBySceneThenUpload(studioProject.resources.filter((r) => r.kind === "sceneVideo"));
  const sceneAudioResources = sortBySceneThenUpload(
    studioProject.resources.filter((r) => r.kind === "sceneAudio" && r.language === language)
  );

  const videoSources = await Promise.all(sceneVideoResources.map((r) => buildSourceFromResource(studioProject, r, "video")));
  const audioSources = await Promise.all(sceneAudioResources.map((r) => buildSourceFromResource(studioProject, r, "audio")));

  const videoClips = videoSources.map((source) => buildClip(VIDEO_TRACK_ID, source));
  const audioClips = audioSources.map((source) => buildClip(AUDIO_TRACK_ID, source));

  const now = Date.now();

  return {
    id: crypto.randomUUID(),
    canvas: { aspectRatio: preset.id, width: preset.width, height: preset.height, frameRate: 30 },
    tracks: [
      { id: VIDEO_TRACK_ID, kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 },
      { id: AUDIO_TRACK_ID, kind: "audio", order: 1, volume: 1, fadeIn: 0, fadeOut: 0 },
      { id: OVERLAY_TRACK_ID, kind: "overlay", order: 2, volume: 1, fadeIn: 0, fadeOut: 0 },
    ],
    clips: [...videoClips, ...audioClips],
    overlays: [],
    sources: [...videoSources, ...audioSources],
    metadata: {
      name: `${studioProject.title} (${language})`,
      templateId: null,
      isTemplate: false,
      createdAt: now,
      updatedAt: now,
      thumbnailDataUrl: null,
    },
  };
}
