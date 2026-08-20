import type { StudioResourceKind } from "./types.js";

export interface ResourceKindConfig {
  kind: StudioResourceKind;
  label: string;
  hint?: string;
  needsLanguage: boolean;
  needsSceneN: boolean;
}

// The single source of truth for what a resource "kind" means across the uploader, the resource
// list, and the overview — one place to add a new kind rather than three.
export const RESOURCE_KINDS: ResourceKindConfig[] = [
  { kind: "sceneVideo", label: "Scene videos", hint: "One clip per scene from Flow", needsLanguage: false, needsSceneN: true },
  { kind: "sceneAudio", label: "Scene audio", hint: "Voiceover or music, per scene and language", needsLanguage: true, needsSceneN: true },
  { kind: "cover", label: "Covers", needsLanguage: false, needsSceneN: false },
  { kind: "logo", label: "Logos", needsLanguage: false, needsSceneN: false },
  { kind: "banner", label: "Banners", needsLanguage: false, needsSceneN: false },
  { kind: "character", label: "Character refs", hint: "The Ingredient image for consistency", needsLanguage: false, needsSceneN: false },
  { kind: "finalExport", label: "Final exports", hint: "The finished video, per language", needsLanguage: true, needsSceneN: false },
  { kind: "other", label: "Other", needsLanguage: false, needsSceneN: false },
];

export function resourceKindConfig(kind: StudioResourceKind): ResourceKindConfig {
  return RESOURCE_KINDS.find((k) => k.kind === kind) ?? RESOURCE_KINDS[RESOURCE_KINDS.length - 1];
}
