import { callLlmJson } from "./llm.js";

// Rhyme Studio: kids poems, generated one at a time so they can render as they land, in every
// requested language at once (not a primary version plus translations, each language's text
// independently rhymes and scans in that language), split into timed scenes, then built into a
// Google Flow (Veo 3.1) reel per target language: one master style bible, one prompt per scene,
// one caption.

export interface Scene {
  /** Keyed by language, e.g. {"English": "...", "Hindi": "..."}. */
  lines: Record<string, string>;
  seconds: number;
}

export interface Poem {
  titles: Record<string, string>;
  poems: Record<string, string>;
  scenes: Scene[];
}

export interface PoemParams {
  topic: string;
  age: string;
  style: string;
  lengthSeconds: number;
  scenes: number;
  languages: string[];
  extra?: string;
  avoidTitles?: string[];
}

export interface ReworkParams extends PoemParams {
  kind: "regenerate" | "optimize" | "enhance";
  current: { titles: Record<string, string>; poems: Record<string, string> };
}

export interface ReelMasterParams {
  title: string;
  topic: string;
  age: string;
}

export interface ReelSceneParams {
  master: string;
  seg: { lines: Record<string, string>; dur: number };
  idx: number;
  total: number;
  primaryLanguage: string;
}

export interface ReelCaptionParams {
  title: string;
  topic: string;
  age: string;
}

const RHYME_SYSTEM = "Follow the instructions exactly. Return only valid JSON, no markdown, no code fences, no commentary.";

const AGE_HINTS: Record<string, string> = {
  "Toddler (2-4)": "very short lines, repeated simple words, easy to sing",
  "Preschool (4-6)": "simple vocabulary, clear AABB rhyme, playful sounds",
  "Early school (6-9)": "richer words, a small idea or lesson, steady rhythm, a little wit",
};

function langNote(l: string): string {
  if (l === "Hindi") return " (Devanagari script)";
  if (l === "Hinglish") return " (Hindi + English mixed, Roman script)";
  return "";
}

// About how many lines a poem of this length and this many languages' worth of scenes wants,
// just a loose steer for the model, not a hard constraint it has to hit exactly.
function approximateLineCount(lengthSeconds: number): number {
  return Math.max(4, Math.round(lengthSeconds / 5));
}

function isPoem(o: unknown): o is Poem {
  const p = o as Poem | null;
  return !!p && typeof p.poems === "object" && p.poems !== null && Array.isArray(p.scenes);
}

function languageJsonExample(languages: string[]): string {
  const titles = languages.map((l) => `"${l}":"..."`).join(",");
  const poems = languages.map((l) => `"${l}":"line1\\nline2"`).join(",");
  const sceneLines = languages.map((l) => `"${l}":"line1"`).join(",");
  return `{"titles":{${titles}},"poems":{${poems}},"scenes":[{"lines":{${sceneLines}},"seconds":7}]}`;
}

function buildPoemPrompt(p: PoemParams): string {
  const hint = AGE_HINTS[p.age] ?? "";
  const languages = p.languages.length ? p.languages : ["English"];
  const primary = languages[0];
  const others = languages.slice(1);
  const lines = approximateLineCount(p.lengthSeconds);

  const languageInstruction =
    others.length === 0
      ? `Primary language: ${primary}${langNote(primary)}.`
      : `Write it in EVERY one of these languages at once, independently, not translations of each other: ${languages.map((l) => `${l}${langNote(l)}`).join(", ")}. Each language's version must rhyme and scan naturally on its own while keeping the same meaning, mood, and the SAME ${p.scenes} scenes, so every language lines up scene by scene.`;

  return `You are a beloved children's poet writing for short vertical video reels.

Topic: ${p.topic}
Audience: ${p.age}. Guidance: ${hint}
Type: ${p.style}
Length: about ${lines} lines, ${p.lengthSeconds} seconds total when read aloud
${languageInstruction}
${p.extra ? `Extra direction: ${p.extra}` : ""}
${p.avoidTitles && p.avoidTitles.length ? `Different from these titles: ${p.avoidTitles.join("; ")}` : ""}

Write the poem with strong sing-song rhythm and clean rhyme in every language above. Then split it into exactly ${p.scenes} timed scenes for a vertical reel. Each scene is a natural chunk of 1 to 3 lines taking about 6 to 9 seconds to recite, with every language's scene lines carrying the same idea at the same point in the poem. Vary the durations to fit the lines. The scenes joined must equal the full poem, in every language.

Return ONLY valid JSON, no markdown, with a "titles" object, a "poems" object, and a "scenes" array, each keyed by the exact language names above:
${languageJsonExample(languages)}
Use \\n between lines within a poem string.`;
}

const REWORK_INTROS: Record<"optimize" | "enhance", string> = {
  optimize:
    "Improve the RHYTHM, meter, and rhyme of this children's poem without changing its meaning, topic, length, or reading level.",
  enhance:
    "Enhance this children's poem: make imagery more vivid and playful, add sound-play or a fun refrain, optionally one short stanza. Keep the original idea.",
};

function buildReworkPrompt(p: ReworkParams): string {
  if (p.kind === "regenerate") {
    const existingTitles = Object.values(p.current.titles).filter((t): t is string => !!t);
    return buildPoemPrompt({ ...p, avoidTitles: [...(p.avoidTitles ?? []), ...existingTitles] });
  }

  const languages = p.languages.length ? p.languages : ["English"];
  const intro = REWORK_INTROS[p.kind];
  const currentBlocks = languages
    .map((l) => `Current ${l} title: ${p.current.titles[l] ?? ""}\nCurrent ${l} poem:\n${p.current.poems[l] ?? ""}`)
    .join("\n\n");

  return `${intro}
Audience ${p.age}. Keep every language version aligned scene by scene and keep it reel friendly.

${currentBlocks}

Re-split into exactly ${p.scenes} timed scenes of about 6 to 9 seconds each, for every language above.

Return ONLY valid JSON, no markdown, with the same "titles", "poems", and "scenes" shape, keyed by the exact language names above:
${languageJsonExample(languages)}
Use \\n between lines within a poem string.`;
}

export async function generatePoem(p: PoemParams): Promise<Poem> {
  return callLlmJson<Poem>(RHYME_SYSTEM, buildPoemPrompt(p), isPoem);
}

export async function reworkPoem(p: ReworkParams): Promise<Poem> {
  return callLlmJson<Poem>(RHYME_SYSTEM, buildReworkPrompt(p), isPoem);
}

function buildReelMasterPrompt(p: ReelMasterParams): string {
  return `You are a prompt engineer for Google Flow (Veo 3.1) vertical reels. Write a MASTER SETUP PROMPT, a reusable style bible, for an animated kids reel of a poem titled "${p.title}" about "${p.topic}" for ${p.age}.

Cover: 9:16 vertical format, animation style, color palette, main character or mascot design for consistency across scenes, mood, lighting, and on-screen text style. Reusable for every scene.

Return ONLY valid JSON, no markdown: {"master":"..."}`;
}

export async function generateReelMaster(p: ReelMasterParams): Promise<{ master: string }> {
  return callLlmJson<{ master: string }>(
    RHYME_SYSTEM,
    buildReelMasterPrompt(p),
    (o): o is { master: string } => !!(o && typeof (o as { master?: unknown }).master === "string")
  );
}

function buildReelScenePrompt(p: ReelSceneParams): string {
  const primaryLines = p.seg.lines[p.primaryLanguage] ?? Object.values(p.seg.lines)[0] ?? "";
  const subtitleLines = Object.entries(p.seg.lines)
    .filter(([lang]) => lang !== p.primaryLanguage)
    .map(([lang, text]) => `On-screen subtitle in ${lang}: "${text.replace(/\n/g, " / ")}"`)
    .join("\n");

  return `Using this master style bible, keep the look 100% consistent:
"""${p.master}"""

Write ONE Google Flow (Veo 3.1) prompt for scene ${p.idx + 1} of ${p.total}, a ${p.seg.dur}-second 9:16 vertical clip.
Spoken/sung audio (${p.primaryLanguage}): "${primaryLines.replace(/\n/g, " / ")}"
${subtitleLines}

Describe the visual action, camera move, and character, all consistent with the master. Self-contained, ready to paste.

Return ONLY valid JSON, no markdown: {"prompt":"..."}`;
}

export async function generateReelScene(p: ReelSceneParams): Promise<{ prompt: string }> {
  return callLlmJson<{ prompt: string }>(
    RHYME_SYSTEM,
    buildReelScenePrompt(p),
    (o): o is { prompt: string } => !!(o && typeof (o as { prompt?: unknown }).prompt === "string")
  );
}

function buildReelCaptionPrompt(p: ReelCaptionParams): string {
  return `Write a short Instagram Reel / YouTube Short caption plus 8 to 12 hashtags for a kids poem titled "${p.title}" about "${p.topic}", audience ${p.age}. Friendly, parent-facing, no em dashes.

Return ONLY valid JSON, no markdown: {"caption":"..."}`;
}

export async function generateReelCaption(p: ReelCaptionParams): Promise<{ caption: string }> {
  return callLlmJson<{ caption: string }>(
    RHYME_SYSTEM,
    buildReelCaptionPrompt(p),
    (o): o is { caption: string } => !!(o && typeof (o as { caption?: unknown }).caption === "string")
  );
}
