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

export type ContentType = "poem" | "story" | "script";

export interface PoemParams {
  topic: string;
  age: string;
  style: string;
  lengthSeconds: number;
  scenes: number;
  languages: string[];
  /** What kind of written piece this is — changes the writing instruction, not the JSON shape. */
  contentType?: ContentType;
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

export interface ReelCharacterParams {
  title: string;
  topic: string;
  age: string;
}

export interface ReelCoverParams {
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

// Checks the model actually returned the requested number of scenes AND that their durations sum
// close to the requested total — without the duration check, a response could have exactly the
// right scene count but still land well under the target (e.g. 15 scenes summing to 90s when 120s
// was asked for) and still pass. 12% tolerance: enough for the model's own "vary durations to fit
// the lines" discretion, not enough to let it systematically undershoot.
function makeIsPoem(expectedScenes: number, expectedLengthSeconds: number): (o: unknown) => o is Poem {
  const tolerance = Math.max(4, expectedLengthSeconds * 0.12);
  return (o: unknown): o is Poem => {
    const p = o as Poem | null;
    if (!p || typeof p.poems !== "object" || p.poems === null || !Array.isArray(p.scenes) || p.scenes.length !== expectedScenes) {
      return false;
    }
    const total = p.scenes.reduce((sum, s) => sum + (Number(s.seconds) || 0), 0);
    return Math.abs(total - expectedLengthSeconds) <= tolerance;
  };
}

// Flat 2000-token default (see llm.ts) is fine for a short single-language poem, but a large
// request — many scenes, several languages, each with its own full poem text plus per-scene
// lines — needs real headroom or the model runs out of budget and the response naturally ends up
// shorter than asked for. Rough estimate: ~40 tokens per scene per language for the scenes array,
// plus ~8 tokens/second of poem text per language for the full poems.
function estimatePoemMaxTokens(p: PoemParams): number {
  const languageCount = Math.max(1, p.languages.length);
  const sceneTokens = p.scenes * languageCount * 40;
  const poemTokens = p.lengthSeconds * languageCount * 8;
  return Math.max(2000, sceneTokens + poemTokens + 500);
}

function languageJsonExample(languages: string[]): string {
  const titles = languages.map((l) => `"${l}":"..."`).join(",");
  const poems = languages.map((l) => `"${l}":"line1\\nline2"`).join(",");
  const sceneLines = languages.map((l) => `"${l}":"line1"`).join(",");
  return `{"titles":{${titles}},"poems":{${poems}},"scenes":[{"lines":{${sceneLines}},"seconds":7}]}`;
}

const CONTENT_TYPE_ROLE: Record<ContentType, string> = {
  poem: "a beloved children's poet",
  story: "a beloved children's story writer",
  script: "a beloved children's video scriptwriter",
};

const CONTENT_TYPE_NOUN: Record<ContentType, string> = {
  poem: "poem",
  story: "story",
  script: "script",
};

const CONTENT_TYPE_INSTRUCTION: Record<ContentType, string> = {
  poem: "Write it with strong sing-song rhythm and clean rhyme",
  story: "Write it as an engaging short narrative with simple, vivid sentences, it does not need to rhyme",
  script: "Write it as spoken narration or dialogue lines ready to read aloud in a video, it does not need to rhyme",
};

function buildPoemPrompt(p: PoemParams): string {
  const hint = AGE_HINTS[p.age] ?? "";
  const languages = p.languages.length ? p.languages : ["English"];
  const primary = languages[0];
  const others = languages.slice(1);
  const lines = approximateLineCount(p.lengthSeconds);
  const contentType = p.contentType ?? "poem";
  const noun = CONTENT_TYPE_NOUN[contentType];

  const languageInstruction =
    others.length === 0
      ? `Primary language: ${primary}${langNote(primary)}.`
      : `Write it in EVERY one of these languages at once, independently, not translations of each other: ${languages.map((l) => `${l}${langNote(l)}`).join(", ")}. Each language's version must read naturally on its own while keeping the same meaning, mood, and the SAME ${p.scenes} scenes, so every language lines up scene by scene.`;

  return `You are ${CONTENT_TYPE_ROLE[contentType]} writing for short vertical video reels.

Topic: ${p.topic}
Audience: ${p.age}. Guidance: ${hint}
Type: ${p.style}
Length: write enough content for ${p.lengthSeconds} seconds total when read aloud (about ${lines} lines). This is a firm target, not a ceiling — do not undershoot it.
${languageInstruction}
${p.extra ? `Extra direction: ${p.extra}` : ""}
${p.avoidTitles && p.avoidTitles.length ? `Different from these titles: ${p.avoidTitles.join("; ")}` : ""}

${CONTENT_TYPE_INSTRUCTION[contentType]} in every language above, with enough lines to fill the full ${p.lengthSeconds} seconds — a short poem split into many scenes is wrong, write more content rather than stretch too little. Then split it into exactly ${p.scenes} timed scenes for a vertical reel, each scene's "seconds" averaging about ${Math.round(p.lengthSeconds / p.scenes)} (vary a little for natural line breaks, but they MUST sum to close to ${p.lengthSeconds} total, not less), with every language's scene lines carrying the same idea at the same point in the ${noun}. The scenes joined must equal the full ${noun}, in every language.

Return ONLY valid JSON, no markdown, with a "titles" object, a "poems" object, and a "scenes" array, each keyed by the exact language names above:
${languageJsonExample(languages)}
Use \\n between lines within a poem string.`;
}

const REWORK_INTROS: Record<"optimize" | "enhance", (noun: string) => string> = {
  optimize: (noun) =>
    `Improve the RHYTHM, flow, and word choice of this children's ${noun} without changing its meaning, topic, length, or reading level.`,
  enhance: (noun) =>
    `Enhance this children's ${noun}: make imagery more vivid and playful, add a fun repeated moment or refrain, optionally one short extra section. Keep the original idea.`,
};

function buildReworkPrompt(p: ReworkParams): string {
  if (p.kind === "regenerate") {
    const existingTitles = Object.values(p.current.titles).filter((t): t is string => !!t);
    return buildPoemPrompt({ ...p, avoidTitles: [...(p.avoidTitles ?? []), ...existingTitles] });
  }

  const languages = p.languages.length ? p.languages : ["English"];
  const noun = CONTENT_TYPE_NOUN[p.contentType ?? "poem"];
  const intro = REWORK_INTROS[p.kind](noun);
  const currentBlocks = languages
    .map((l) => `Current ${l} title: ${p.current.titles[l] ?? ""}\nCurrent ${l} ${noun}:\n${p.current.poems[l] ?? ""}`)
    .join("\n\n");

  return `${intro}
Audience ${p.age}. Keep every language version aligned scene by scene and keep it reel friendly.

${currentBlocks}

Re-split into exactly ${p.scenes} timed scenes, each scene's "seconds" averaging about ${Math.round(p.lengthSeconds / p.scenes)} (vary a little for natural line breaks, but they MUST sum to close to ${p.lengthSeconds} seconds total, not less), for every language above.

Return ONLY valid JSON, no markdown, with the same "titles", "poems", and "scenes" shape, keyed by the exact language names above:
${languageJsonExample(languages)}
Use \\n between lines within a poem string.`;
}

export async function generatePoem(p: PoemParams): Promise<Poem> {
  return callLlmJson<Poem>(RHYME_SYSTEM, buildPoemPrompt(p), makeIsPoem(p.scenes, p.lengthSeconds), 3, estimatePoemMaxTokens(p));
}

export async function reworkPoem(p: ReworkParams): Promise<Poem> {
  return callLlmJson<Poem>(RHYME_SYSTEM, buildReworkPrompt(p), makeIsPoem(p.scenes, p.lengthSeconds), 3, estimatePoemMaxTokens(p));
}

function buildReelMasterPrompt(p: ReelMasterParams): string {
  return `You are a prompt engineer for Google Flow (Veo 3.1) vertical kids reels. Write a MASTER SETUP PROMPT — a detailed, reusable style bible — for an animated reel of a poem titled "${p.title}" about "${p.topic}", for ${p.age}.

Write it as full sentences that explain, clearly enough that every later scene/character/cover prompt can copy it verbatim as their shared style anchor and stay consistent with each other:
1. Animation style and rendering (e.g. 2D flat vector, 3D claymation, watercolor) and why it fits the audience.
2. Color palette (name the actual colors) and overall mood/lighting.
3. The main character/mascot's design in enough detail to redraw it identically every time.
4. Setting/world details that recur across scenes.
5. On-screen text style, if any (font feel, color, placement), for captions/titles.

Write it as ONE continuous, well-organized prompt (the numbered list above is just what to cover, not the format), ready to paste as-is before every other prompt.

Return ONLY valid JSON, no markdown: {"master":"..."}`;
}

export async function generateReelMaster(p: ReelMasterParams): Promise<{ master: string }> {
  return callLlmJson<{ master: string }>(
    RHYME_SYSTEM,
    buildReelMasterPrompt(p),
    (o): o is { master: string } => !!(o && typeof (o as { master?: unknown }).master === "string")
  );
}

function buildReelCharacterPrompt(p: ReelCharacterParams): string {
  return `You are a character designer for Google Flow (Veo 3.1) vertical kids reels. Design the MAIN CHARACTER (or mascot) for a reel titled "${p.title}" about "${p.topic}", for ${p.age}.

Describe it in enough visual detail to regenerate this exact character identically across every scene:
- Species/type and defining physical features (shape, size, colors, patterns)
- Face and expression style (eyes, expression range, how emotion reads)
- Outfit or markings, if any, and their colors
- Personality conveyed through posture and design
- The animation/art style it's rendered in, matching the master style bible

Write it as ONE self-contained Google Flow prompt, ready to paste, for generating a clean reference image of this character alone on a plain background (a turnaround/model sheet, not a scene).

Return ONLY valid JSON, no markdown: {"prompt":"..."}`;
}

export async function generateReelCharacter(p: ReelCharacterParams): Promise<{ prompt: string }> {
  return callLlmJson<{ prompt: string }>(
    RHYME_SYSTEM,
    buildReelCharacterPrompt(p),
    (o): o is { prompt: string } => !!(o && typeof (o as { prompt?: unknown }).prompt === "string")
  );
}

function buildReelCoverPrompt(p: ReelCoverParams): string {
  return `You are a thumbnail/cover designer for a kids' YouTube Short / Instagram Reel titled "${p.title}" about "${p.topic}", for ${p.age}.

Write ONE Google Flow / image-gen prompt for an eye-catching 9:16 vertical COVER/THUMBNAIL image: the main character in an appealing pose, a bold readable title-text treatment (describe its placement and style, not the literal words), bright inviting colors, a clear focal point that still reads well shrunk down to thumbnail size. Consistent with the reel's master style bible.

Return ONLY valid JSON, no markdown: {"prompt":"..."}`;
}

export async function generateReelCover(p: ReelCoverParams): Promise<{ prompt: string }> {
  return callLlmJson<{ prompt: string }>(
    RHYME_SYSTEM,
    buildReelCoverPrompt(p),
    (o): o is { prompt: string } => !!(o && typeof (o as { prompt?: unknown }).prompt === "string")
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
