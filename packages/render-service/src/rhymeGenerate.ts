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
  /** Seconds per scene (matches the video-gen model's fixed clip length, e.g. Veo). Every scene's
   * "seconds" is forced to this value server-side after generation — never trusted from the model,
   * since it's fixed infrastructure, not something for the model to estimate. */
  clipLengthSeconds: number;
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

// Unlike ReworkParams, this never touches the words — the model isn't even shown as a rewrite
// target, only as fixed reference text to re-split. The caller also ignores anything the model
// might echo back beyond "scenes" and keeps its own poems/titles verbatim, so lyric drift is
// impossible by construction, not just by prompt instruction.
export interface FixTimelineParams {
  poems: Record<string, string>;
  languages: string[];
  scenes: number;
  lengthSeconds: number;
  clipLengthSeconds: number;
}

export interface ReelMasterParams {
  /** Both optional — a poem pasted in from an external chat AI often has no topic filled in (and
   * sometimes no title yet either), and poemText carries the real content regardless. */
  title?: string;
  topic?: string;
  age: string;
  /** The actual lyrics, so the style bible reflects specific story beats/imagery, not just the
   * short topic phrase. Optional so a caller without it (or an older client) still works. */
  poemText?: string;
}

export interface ReelSceneParams {
  master: string;
  seg: { lines: Record<string, string>; dur: number };
  idx: number;
  total: number;
  primaryLanguage: string;
}

export interface ReelCaptionParams {
  title?: string;
  topic?: string;
  age: string;
  poemText?: string;
}

export interface ReelCharacterParams {
  title?: string;
  topic?: string;
  age: string;
  poemText?: string;
  /** The already-generated master style bible, so this can actually match it (same as
   * ReelSceneParams already does) instead of just being told to "match" text it never sees. */
  master?: string;
}

export interface ReelCoverParams {
  title?: string;
  topic?: string;
  age: string;
  master?: string;
  poemText?: string;
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

// Only checks the scene count — durations are never trusted from the model at all (see
// forceSceneDurations below), so there's nothing to validate about them. Scene count still needs
// enforcing: a response could easily come back with too few scenes otherwise.
function makeIsPoem(expectedScenes: number): (o: unknown) => o is Poem {
  return (o: unknown): o is Poem => {
    const p = o as Poem | null;
    return !!p && typeof p.poems === "object" && p.poems !== null && Array.isArray(p.scenes) && p.scenes.length === expectedScenes;
  };
}

// Every scene is exactly clipLengthSeconds long — that's the video-gen model's fixed clip length,
// not something the writing model estimates or varies. Whatever "seconds" the model may have put
// in its response (if anything, since the prompt no longer even asks for it) is overwritten here,
// so the timeline is strictly uniform by construction regardless of model behavior.
function forceSceneDurations(scenes: Scene[], clipLengthSeconds: number): Scene[] {
  return scenes.map((s) => ({ ...s, seconds: clipLengthSeconds }));
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

// No "seconds" in the shape the model is asked for — every scene's duration is fixed
// (clipLengthSeconds) and forced server-side afterward, never left to the model to state.
function languageJsonExample(languages: string[]): string {
  const titles = languages.map((l) => `"${l}":"..."`).join(",");
  const poems = languages.map((l) => `"${l}":"line1\\nline2"`).join(",");
  const sceneLines = languages.map((l) => `"${l}":"line1"`).join(",");
  return `{"titles":{${titles}},"poems":{${poems}},"scenes":[{"lines":{${sceneLines}}}]}`;
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

${CONTENT_TYPE_INSTRUCTION[contentType]} in every language above, with enough lines to fill the full ${p.lengthSeconds} seconds — a short poem split into many scenes is wrong, write more content rather than stretch too little. Then split it into EXACTLY ${p.scenes} scenes, one per ${p.clipLengthSeconds}-second video clip (${p.scenes} clips x ${p.clipLengthSeconds}s = ${p.lengthSeconds}s total — this is fixed, not your choice). Each scene holds 1 to 3 lines that naturally fit speaking/singing in about ${p.clipLengthSeconds} seconds, with every language's scene lines carrying the same idea at the same point in the ${noun}. If the ${noun} doesn't have enough natural content to fill every one of the ${p.scenes} scenes with words, that's fine — give a trailing or transitional scene EMPTY "lines" (an instrumental/music-only beat, no vocals) for every language, rather than stretching or repeating text unnaturally. The scene COUNT must still be exactly ${p.scenes}, even if some are empty.

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

Re-split into EXACTLY ${p.scenes} scenes, one per ${p.clipLengthSeconds}-second video clip (${p.scenes} clips x ${p.clipLengthSeconds}s = ${p.lengthSeconds}s total — fixed, not your choice), for every language above. If there isn't enough content to fill every scene with words, leave a trailing/transitional scene's "lines" empty (music-only, no vocals) rather than stretching text — but the scene count must still be exactly ${p.scenes}.

Return ONLY valid JSON, no markdown, with the same "titles", "poems", and "scenes" shape, keyed by the exact language names above:
${languageJsonExample(languages)}
Use \\n between lines within a poem string.`;
}

export async function generatePoem(p: PoemParams): Promise<Poem> {
  const poem = await callLlmJson<Poem>(RHYME_SYSTEM, buildPoemPrompt(p), makeIsPoem(p.scenes), 3, estimatePoemMaxTokens(p));
  return { ...poem, scenes: forceSceneDurations(poem.scenes, p.clipLengthSeconds) };
}

export async function reworkPoem(p: ReworkParams): Promise<Poem> {
  const poem = await callLlmJson<Poem>(RHYME_SYSTEM, buildReworkPrompt(p), makeIsPoem(p.scenes), 3, estimatePoemMaxTokens(p));
  return { ...poem, scenes: forceSceneDurations(poem.scenes, p.clipLengthSeconds) };
}

function buildFixTimelinePrompt(p: FixTimelineParams): string {
  const languages = p.languages.length ? p.languages : Object.keys(p.poems);
  const blocks = languages.map((l) => `${l}:\n${p.poems[l] ?? ""}`).join("\n\n");

  return `Do NOT change, translate, rephrase, correct, or add to any words below — copy every line into scenes 100% verbatim, exactly as written.

${blocks}

Your only task: split the text above into EXACTLY ${p.scenes} scenes, one per ${p.clipLengthSeconds}-second video clip (${p.scenes} clips x ${p.clipLengthSeconds}s = ${p.lengthSeconds}s total — fixed, not your choice), keyed by the same language names. Each scene is a natural chunk of 1 to 3 CONSECUTIVE lines taken word-for-word from the text above (never invented, never reworded), fitting about ${p.clipLengthSeconds} seconds of speech, with every language's scene lines carrying the same idea at the same point so all languages line up scene by scene. If the text runs out before filling all ${p.scenes} scenes, leave the remaining trailing scene(s)' "lines" empty (music-only, no vocals) for every language — never invent or stretch text to fill space. The scene count must still be exactly ${p.scenes}.

Return ONLY valid JSON, no markdown, with just a "scenes" array, keyed by the exact language names above:
{"scenes":[{"lines":{${languages.map((l) => `"${l}":"..."`).join(",")}}}]}`;
}

function makeIsScenesResult(expectedScenes: number): (o: unknown) => o is { scenes: Scene[] } {
  return (o: unknown): o is { scenes: Scene[] } => {
    const r = o as { scenes?: Scene[] } | null;
    return !!r && Array.isArray(r.scenes) && r.scenes.length === expectedScenes;
  };
}

// Lighter than estimatePoemMaxTokens: no full poem text to regenerate, just the scenes array (each
// scene repeats a line or two per language) plus the reference text itself in the prompt.
function estimateFixTimelineMaxTokens(p: FixTimelineParams): number {
  const languageCount = Math.max(1, p.languages.length);
  const sceneTokens = p.scenes * languageCount * 40;
  return Math.max(1200, sceneTokens + 500);
}

export async function fixPoemTimeline(p: FixTimelineParams): Promise<{ scenes: Scene[] }> {
  const result = await callLlmJson<{ scenes: Scene[] }>(
    RHYME_SYSTEM,
    buildFixTimelinePrompt(p),
    makeIsScenesResult(p.scenes),
    3,
    estimateFixTimelineMaxTokens(p)
  );
  return { scenes: forceSceneDurations(result.scenes, p.clipLengthSeconds) };
}

// Included in master/character/cover/caption prompts so they're grounded in the actual story
// (specific imagery, events, refrains) rather than only the short topic phrase, which strips out
// everything the poem actually says.
function poemContextBlock(poemText?: string): string {
  return poemText?.trim() ? `\nFull lyrics, for context on the actual story/imagery to depict:\n"""${poemText.trim()}"""\n` : "";
}

// A poem pasted in from an external chat AI often has no topic filled in (sometimes no title
// either) — gracefully compose whatever's actually present instead of erroring, since poemText
// (when given) carries the real content regardless of whether either of these is set.
function titleTopicPhrase(title?: string, topic?: string): string {
  const t = title?.trim();
  const top = topic?.trim();
  if (t && top) return `titled "${t}" about "${top}"`;
  if (t) return `titled "${t}"`;
  if (top) return `about "${top}"`;
  return "described by the lyrics below";
}

function buildReelMasterPrompt(p: ReelMasterParams): string {
  return `You are a prompt engineer for Google Flow (Veo 3.1) vertical kids reels. Write a MASTER SETUP PROMPT — a detailed, reusable style bible — for an animated reel of a poem ${titleTopicPhrase(p.title, p.topic)}, for ${p.age}.
${poemContextBlock(p.poemText)}
Write it as full sentences that explain, clearly enough that every later scene/character/cover prompt can copy it verbatim as their shared style anchor and stay consistent with each other:
1. Animation style: 3D animated (Pixar/DreamWorks-style rendering — rounded, dimensional, soft-shaded characters and environments, NOT 2D/flat/vector). Describe the specific 3D look (e.g. soft claymation-like shading, smooth toy-like plastic finish, painterly 3D) and why it fits the audience.
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
  const masterBlock = p.master ? `\nMaster style bible, keep the look 100% consistent with it:\n"""${p.master}"""\n` : "";
  return `You are a character designer for Google Flow (Veo 3.1) vertical kids reels. Design the MAIN CHARACTER (or mascot) for a reel ${titleTopicPhrase(p.title, p.topic)}, for ${p.age}.
${masterBlock}${poemContextBlock(p.poemText)}
Describe it in enough visual detail to regenerate this exact character identically across every scene:
- Species/type and defining physical features (shape, size, colors, patterns)
- Face and expression style (eyes, expression range, how emotion reads)
- Outfit or markings, if any, and their colors
- Personality conveyed through posture and design
- The animation/art style it's rendered in, matching the master style bible above

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
  const masterBlock = p.master ? `\nMaster style bible, keep the look 100% consistent with it:\n"""${p.master}"""\n` : "";
  return `You are a thumbnail/cover designer for a kids' YouTube Short / Instagram Reel ${titleTopicPhrase(p.title, p.topic)}, for ${p.age}.
${masterBlock}${poemContextBlock(p.poemText)}
Write ONE Google Flow / image-gen prompt for an eye-catching 9:16 vertical COVER/THUMBNAIL image: the main character in an appealing pose (pick a moment/pose that reflects the poem's story), a bold readable title-text treatment (describe its placement and style, not the literal words), bright inviting colors, a clear focal point that still reads well shrunk down to thumbnail size, matching the master style bible above.

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
  return `Write a short Instagram Reel / YouTube Short caption plus 8 to 12 hashtags for a kids poem ${titleTopicPhrase(p.title, p.topic)}, audience ${p.age}. Friendly, parent-facing, no em dashes.
${poemContextBlock(p.poemText)}

Return ONLY valid JSON, no markdown: {"caption":"..."}`;
}

export async function generateReelCaption(p: ReelCaptionParams): Promise<{ caption: string }> {
  return callLlmJson<{ caption: string }>(
    RHYME_SYSTEM,
    buildReelCaptionPrompt(p),
    (o): o is { caption: string } => !!(o && typeof (o as { caption?: unknown }).caption === "string")
  );
}
