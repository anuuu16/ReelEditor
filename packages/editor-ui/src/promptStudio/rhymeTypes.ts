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

export interface RhymePoemParams {
  topic: string;
  age: string;
  style: string;
  lengthSeconds: number;
  scenes: number;
  /** Every language to generate at once, in order. First is the "primary" for display purposes only. */
  languages: string[];
  extra?: string;
  avoidTitles?: string[];
}

export interface RhymeReworkParams extends RhymePoemParams {
  kind: "regenerate" | "optimize" | "enhance";
  current: { titles: Record<string, string>; poems: Record<string, string> };
}

export interface RhymeReelMasterParams {
  title: string;
  topic: string;
  age: string;
}

export interface RhymeReelSceneParams {
  master: string;
  seg: { lines: Record<string, string>; dur: number };
  idx: number;
  total: number;
  /** Which language's lines are the spoken/sung audio; every other language present becomes an
   * on-screen subtitle line. */
  primaryLanguage: string;
}

export interface RhymeReelCaptionParams {
  title: string;
  topic: string;
  age: string;
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

/** A generated Flow reel for one poem version, in one language: one master, one prompt per
 * scene, one caption. */
export interface RhymeReel {
  master: string;
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
