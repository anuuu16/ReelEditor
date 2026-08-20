import { accountForScene, buildAccounts, creditsPerClipForModel, type AccountGroupResult } from "./creditMath.js";
import type { StudioProject, StudioScene } from "./types.js";

// What kind of written piece (if any) drives the scenes — a poem, a storyline/synopsis, a script,
// or none at all. The pipeline downstream (scenes, prompts, accounts, resources) doesn't care
// which one it is; this only changes the wording of the one instruction asking for it.
export type WrittenContentKind = "poem" | "storyline" | "script" | "none";

const CONTENT_KIND_INSTRUCTION: Record<Exclude<WrittenContentKind, "none">, string> = {
  poem: "a short, simple, rhyming poem or song lyrics",
  storyline: "a short narrative storyline or synopsis",
  script: "a short script or voiceover script",
};

export interface ExternalPromptParams {
  topic: string;
  numScenes: number;
  style: string;
  lang: string;
  ownAudio: boolean;
  extra: string;
  videoType: "reel" | "full_video";
  aspectRatio: string;
  contentKind: WrittenContentKind;
}

function audioLine(ownAudio: boolean): string {
  return ownAudio
    ? "Do not write spoken dialogue or singing voices in the scene prompts, only light ambient sound, since a separate music or voice track will be added later. Characters express themselves through facial expressions and body movement, not speech."
    : "Scene prompts may include ambient sound, sound effects, music, and spoken dialogue in quotes where it fits.";
}

// A single copy-paste-ready block for pasting into ANY chat AI (Claude, ChatGPT, whichever), so a
// Studio project's written content and prompts never require this app's own generate endpoint.
export function buildExternalPromptTemplate(params: ExternalPromptParams): string {
  const paddedTotal = String(params.numScenes).padStart(2, "0");
  const contentInstruction =
    params.contentKind !== "none"
      ? `First write ${CONTENT_KIND_INSTRUCTION[params.contentKind]} for this video, in the language "${params.lang}", about: ${params.topic || "(the topic below)"}. Put it in the JSON under "poem" as {"${params.lang}": "the text, with line breaks written as \\n"} (call the field "poem" regardless of whether this is a poem, storyline, or script).\n\n`
      : "";

  return `You are an expert AI video prompt engineer for Google Flow (Veo 3.1). ${contentInstruction}Then write a complete video generation plan of ${params.numScenes} scenes of about 8 seconds each (about ${params.numScenes * 8} seconds total), aspect ratio ${params.aspectRatio}.

Topic: ${params.topic || "(see the poem above)"}
Video type: ${params.videoType === "reel" ? "short vertical reel for Instagram Reels / YouTube Shorts" : "full landscape video for YouTube"}
Visual style: ${params.style || "your choice, but state it clearly and keep it identical across every scene"}
${params.extra ? `Extra direction: ${params.extra}\n` : ""}${audioLine(params.ownAudio)}

Consistency matters: every recurring character, wardrobe, prop, setting, color grade, and visual style must be described with identical wording in every single scene prompt. Never write "same as before", every scene prompt must stand alone and be copy paste ready for Flow. Never use em dashes, use commas or periods or "and" or "but" instead.

Return ONLY valid JSON, no markdown, no code fences, exactly this shape (omit "poem" if you were not asked to write one above):
{
  "poem": {"${params.lang}": "poem text..."},
  "concept": "one line concept",
  "hook": "on screen text hook for the first 2 seconds",
  "masterPrompt": "the full master setup prompt: state the concept, that this is a ${params.numScenes} scene sequence rendered as ${params.numScenes} separate clips of about 8 seconds each generated and joined in numbered order, the exact visual style, full descriptions of every recurring character with fixed names/colors/proportions, the setting and mood, the audio approach, and the clip naming convention (scene_01 up to scene_${paddedTotal})",
  "caption": "a platform ready caption",
  "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "scenes": [
    {"n": 1, "title": "short scene title", "timeStart": "0:00", "timeEnd": "0:08", "durationSeconds": 8, "prompt": "the full, self contained Flow prompt for this scene"}
  ]
}
Write all ${params.numScenes} scenes, numbered 1 to ${params.numScenes}, in order, each a complete standalone prompt.`;
}

function stripCodeFences(text: string): string {
  return text.replace(/```json/gi, "```").replace(/```/g, "");
}

function extractJsonObject(text: string): unknown {
  const stripped = stripCodeFences(text).trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) {
      throw new Error("No JSON object found in the pasted text");
    }
    return JSON.parse(stripped.slice(start, end + 1));
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface ParsedImport {
  poem?: Record<string, string>;
  concept?: string;
  hook?: string;
  masterPrompt?: string;
  caption?: string;
  hashtags?: string[];
  scenes: StudioScene[];
  accounts: AccountGroupResult[];
}

// Accepts our own JSON contract, the raw camelCase/snake_case shape a plain generation call
// returns, or the wrapped {schemaVersion, projects: [...]} seed-file shape (takes the first
// project). account/accounts from the pasted JSON are never trusted for the arithmetic — they are
// always recomputed from this project's own model/creditsPerAccount, so a scene list from any
// source ends up grouped correctly regardless of what (if anything) the source itself computed.
export function parseAndNormalizeImport(raw: string, project: StudioProject): ParsedImport {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = extractJsonObject(raw);

  if (!Array.isArray(data?.scenes) && Array.isArray(data?.projects) && data.projects.length > 0) {
    data = data.projects[0];
  }

  const rawScenes: unknown[] = Array.isArray(data?.scenes) ? data.scenes : [];
  if (rawScenes.length === 0) {
    throw new Error('No "scenes" array found in the pasted JSON');
  }

  const creditsPerClip = project.creditsPerClip || creditsPerClipForModel(project.model);
  const accounts = buildAccounts(rawScenes.length, project.creditsPerAccount, creditsPerClip);

  const scenes: StudioScene[] = rawScenes.map((entry, index) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = entry as any;
    const n = Number.isFinite(s?.n) ? Number(s.n) : index + 1;
    const durationSeconds = Number.isFinite(s?.durationSeconds) ? Number(s.durationSeconds) : 8;
    return {
      n,
      clipName: typeof s?.clipName === "string" && s.clipName ? s.clipName : `scene_${pad2(n)}`,
      account: Number.isFinite(s?.account) ? Number(s.account) : accountForScene(accounts, n),
      section: typeof s?.section === "string" ? s.section : undefined,
      title: typeof s?.title === "string" ? s.title : "",
      timeStart: typeof s?.timeStart === "string" ? s.timeStart : formatTime((n - 1) * 8),
      timeEnd: typeof s?.timeEnd === "string" ? s.timeEnd : formatTime(n * 8),
      durationSeconds,
      shot: typeof s?.shot === "string" ? s.shot : undefined,
      audio: typeof s?.audio === "string" ? s.audio : undefined,
      prompt: typeof s?.prompt === "string" ? s.prompt : "",
    };
  });

  const poem = typeof data?.poem === "object" && data.poem !== null ? (data.poem as Record<string, string>) : undefined;
  const masterPrompt =
    typeof data?.masterPrompt === "string" ? data.masterPrompt : typeof data?.master_prompt === "string" ? data.master_prompt : undefined;
  const hashtags = Array.isArray(data?.hashtags) ? data.hashtags.filter((h: unknown): h is string => typeof h === "string") : undefined;

  return {
    poem,
    concept: typeof data?.concept === "string" ? data.concept : undefined,
    hook: typeof data?.hook === "string" ? data.hook : undefined,
    masterPrompt,
    caption: typeof data?.caption === "string" ? data.caption : undefined,
    hashtags,
    scenes,
    accounts,
  };
}
