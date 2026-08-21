// Wire types mirrored by hand from packages/render-service/src/studioProjects.ts and
// studioGenerate.ts. editor-ui does not depend on render-service as a package, so these are kept
// as a hand-maintained single source of truth for the rest of this feature to import from.

import type { RhymePoemSlot } from "./rhymeTypes.js";

export type StudioResourceKind =
  | "cover"
  | "logo"
  | "banner"
  | "character"
  | "sceneVideo"
  | "sceneAudio"
  | "finalExport"
  | "other";

export interface MetadataVariant {
  label?: string;
  language?: string;
  title?: string;
  description?: string;
  hashtags?: string[];
}

export interface StudioResource {
  id: string;
  kind: StudioResourceKind;
  language: string | null;
  sceneN: number | null;
  filename: string;
  metadata: MetadataVariant[];
  uploadedAt: number;
}

export interface StudioScene {
  n: number;
  clipName: string;
  account: number;
  section?: string;
  title?: string;
  timeStart?: string;
  timeEnd?: string;
  durationSeconds: number;
  shot?: string;
  audio?: string;
  prompt: string;
}

export interface StudioAccountGroup {
  account: number;
  sceneRange: [number, number];
  clips: number;
  credits: number;
}

export interface StudioEditorProjectLink {
  language: string;
  editorProjectId: string;
  label?: string;
}

export interface StudioProject {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  languages: string[];
  /** Poem/lyrics text, keyed by language code, filled in by generation, by pasting, or both. */
  poem: Record<string, string>;
  videoType: "reel" | "full_video";
  aspectRatio: string;
  platform?: string;
  style?: string;
  model: string;
  creditsPerClip: number;
  creditsPerAccount: number;
  namingConvention?: string;
  concept?: string;
  hook?: string;
  masterPrompt: string;
  /** Target total video duration in seconds. No upper bound — Rhyme Studio splits it into
   * clipLengthSeconds-sized scenes, however many that takes. */
  totalLengthSeconds?: number;
  /** Seconds per generated clip (matches the video-gen model's own clip length, e.g. Veo). Drives
   * how many scenes totalLengthSeconds gets split into. */
  clipLengthSeconds?: number;
  caption?: string;
  hashtags?: string[];
  accounts: StudioAccountGroup[];
  scenes: StudioScene[];
  resources: StudioResource[];
  editorProjects: StudioEditorProjectLink[];
  metadata: MetadataVariant[];
  poems?: RhymePoemSlot[];
}

export interface StudioProjectSummary {
  id: string;
  title: string;
  updatedAt: number;
  languages: string[];
  sceneCount: number;
  resourceCount: number;
  editorProjectCount: number;
}

export type StudioGenerateModel = "Veo 3.1 Lite" | "Veo 3.1 Fast" | "Veo 3.1 Quality";

export interface StudioGenerateRequest {
  topic: string;
  videoType: "reel" | "full_video";
  platform: string;
  numScenes: number;
  style: string;
  lang: string;
  ownAudio: boolean;
  extra: string;
  model: StudioGenerateModel;
  creditsPerAccount: number;
}

export interface StudioGenerateBaseResult {
  concept: string;
  hook: string;
  master_prompt: string;
  caption: string;
  hashtags: string[];
}

export type StudioGenerateSSEEvent =
  | { type: "base"; data: StudioGenerateBaseResult }
  | { type: "scene"; data: { progressLabel: string; scene: StudioScene } }
  | { type: "done"; data: { base: StudioGenerateBaseResult; scenes: StudioScene[]; accounts: StudioAccountGroup[] } }
  | { type: "error"; data: { message: string } };

/** Fields accepted by POST /studio (all optional, the server fills sane defaults). */
export interface CreateStudioProjectBody {
  title?: string;
  languages?: string[];
  videoType?: "reel" | "full_video";
  aspectRatio?: string;
  platform?: string;
  style?: string;
  model?: string;
  creditsPerClip?: number;
  creditsPerAccount?: number;
}

/** Fields accepted by PATCH /studio/:id/resources/:resourceId. */
export interface PatchStudioResourceBody {
  metadata?: MetadataVariant[];
  kind?: StudioResourceKind;
  language?: string | null;
  sceneN?: number | null;
}

/** Fields accepted by POST /studio/:id/resources as multipart text fields, alongside the file. */
export interface UploadStudioResourceFields {
  kind: StudioResourceKind;
  language?: string;
  sceneN?: number;
}
