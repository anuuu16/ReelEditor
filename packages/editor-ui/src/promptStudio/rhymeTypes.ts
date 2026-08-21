// Wire types mirrored by hand from packages/render-service/src/rhymeGenerate.ts.

/** One scene's lines, keyed by language code, e.g. {"English": "...", "Hindi": "..."}. */
export interface RhymeScene {
  lines: Record<string, string>;
  seconds: number;
}

/** A poem in every requested language at once, not a primary version plus translations — each
 * language's text is independently written to rhyme and scan in that language. */
export interface RhymePoem {
  titles: Record<string, string>;
  poems: Record<string, string>;
  scenes: RhymeScene[];
}

export type RhymeContentType = "poem" | "story" | "script";

export interface RhymePoemParams {
  topic: string;
  age: string;
  style: string;
  lengthSeconds: number;
  scenes: number;
  /** Seconds per scene (matches the video-gen model's fixed clip length, e.g. Veo). Optional since
   * a slot saved before this field existed won't have it — falls back to 8 wherever read. */
  clipLengthSeconds?: number;
  /** Every language to generate at once, in order. First is the "primary" for display purposes only. */
  languages: string[];
  /** What kind of written piece this is — a poem is not the only option. */
  contentType: RhymeContentType;
  extra?: string;
  avoidTitles?: string[];
}

export interface RhymeReworkParams extends RhymePoemParams {
  kind: "regenerate" | "optimize" | "enhance";
  current: { titles: Record<string, string>; poems: Record<string, string> };
}

// Unlike RhymeReworkParams, the words never change — only "scenes" comes back, so lyric drift is
// impossible by construction rather than by trusting the model to leave text alone.
export interface RhymeFixTimelineParams {
  poems: Record<string, string>;
  languages: string[];
  scenes: number;
  lengthSeconds: number;
  clipLengthSeconds: number;
}

export interface RhymeReelMasterParams {
  title: string;
  topic: string;
  age: string;
  /** The actual lyrics, so the style bible reflects specific story beats/imagery, not just topic. */
  poemText?: string;
  /** e.g. "9:16", "16:9", "1:1" — the project's actual canvas shape (Settings > Aspect ratio). */
  aspectRatio?: string;
}

export interface RhymeReelSceneParams {
  master: string;
  seg: { lines: Record<string, string>; dur: number };
  idx: number;
  total: number;
  /** Which language's lines are the spoken/sung audio; every other language present becomes an
   * on-screen subtitle line. */
  primaryLanguage: string;
  aspectRatio?: string;
}

export interface RhymeReelCaptionParams {
  title: string;
  topic: string;
  age: string;
  poemText?: string;
}

export interface RhymeReelCharacterParams {
  title: string;
  topic: string;
  age: string;
  poemText?: string;
  master?: string;
  aspectRatio?: string;
}

export interface RhymeReelCoverParams {
  title: string;
  topic: string;
  age: string;
  master?: string;
  poemText?: string;
  aspectRatio?: string;
}

/** One saved version of a poem, appended never overwritten, so earlier drafts stay reachable. */
export interface RhymePoemVersion {
  id: string;
  label: string;
  poem: RhymePoem;
  createdAt: number;
  /** One built reel per target language, since each language gets its own separate final video. */
  reels?: Record<string, RhymeReel>;
}

/** A generated Flow reel for one poem version, in one language: one master style bible, one
 * character reference prompt, one cover/thumbnail prompt, one prompt per scene, one caption.
 * characterPrompt/coverPrompt are optional since a reel saved before they existed won't have them. */
export interface RhymeReel {
  master: string;
  characterPrompt?: string;
  coverPrompt?: string;
  scenePrompts: string[];
  caption: string;
}

/** One "poem" slot in a Studio project: the generation params it was created with, plus every
 * version ever produced for it (regenerate/optimize/enhance all append, never replace). */
export interface RhymePoemSlot {
  id: string;
  params: RhymePoemParams;
  versions: RhymePoemVersion[];
  activeVersionIndex: number;
}
