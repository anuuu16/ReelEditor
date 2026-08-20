// Wire types mirrored by hand from packages/render-service/src/rhymeGenerate.ts.

export interface RhymeScene {
  lines: string;
  lines2?: string;
  seconds: number;
}

export interface RhymePoem {
  title: string;
  title2?: string;
  poem: string;
  poem2?: string;
  scenes: RhymeScene[];
}

export interface RhymePoemParams {
  topic: string;
  age: string;
  style: string;
  lines: number;
  scenes: number;
  lang: string;
  lang2?: string;
  extra?: string;
  avoidTitles?: string[];
}

export interface RhymeReworkParams extends RhymePoemParams {
  kind: "regenerate" | "optimize" | "enhance";
  current: { title: string; poem: string; poem2?: string; title2?: string };
}

export interface RhymeReelMasterParams {
  title: string;
  topic: string;
  age: string;
}

export interface RhymeReelSceneParams {
  master: string;
  seg: { lines: string; lines2?: string; dur: number };
  idx: number;
  total: number;
  lang: string;
  lang2?: string;
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
  reel?: RhymeReel;
}

/** A generated Flow reel for one poem version: one master, one prompt per scene, one caption. */
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
