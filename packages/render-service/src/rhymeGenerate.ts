import { callLlmJson } from "./llm.js";

// Rhyme Studio: kids poems, generated one at a time so they can render as they land, split into
// timed scenes, optionally bilingual (same scenes, same meaning, both rhyming), then built into a
// Google Flow (Veo 3.1) reel: one master style bible, one prompt per scene, one caption.

export interface Scene {
  lines: string;
  lines2?: string;
  seconds: number;
}

export interface Poem {
  title: string;
  title2?: string;
  poem: string;
  poem2?: string;
  scenes: Scene[];
}

export interface PoemParams {
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

export interface ReworkParams extends PoemParams {
  kind: "regenerate" | "optimize" | "enhance";
  current: { title: string; poem: string; poem2?: string; title2?: string };
}

export interface ReelMasterParams {
  title: string;
  topic: string;
  age: string;
}

export interface ReelSceneParams {
  master: string;
  seg: { lines: string; lines2?: string; dur: number };
  idx: number;
  total: number;
  lang: string;
  lang2?: string;
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

function isBilingual(lang: string, lang2: string | undefined): boolean {
  return !!lang2 && lang2 !== "None" && lang2 !== lang;
}

function isPoem(o: unknown): o is Poem {
  const p = o as Poem | null;
  return !!p && typeof p.poem === "string" && Array.isArray(p.scenes);
}

function buildPoemPrompt(p: PoemParams): string {
  const hint = AGE_HINTS[p.age] ?? "";
  const bilingual = isBilingual(p.lang, p.lang2);

  let prompt = `You are a beloved children's poet writing for short vertical video reels.

Topic: ${p.topic}
Audience: ${p.age}. Guidance: ${hint}
Type: ${p.style}
Length: about ${p.lines} lines
Primary language: ${p.lang}${langNote(p.lang)}
${p.extra ? `Extra direction: ${p.extra}` : ""}
${p.avoidTitles && p.avoidTitles.length ? `Different from these titles: ${p.avoidTitles.join("; ")}` : ""}

Write the poem with strong sing-song rhythm and clean rhyme. Then split it into exactly ${p.scenes} timed scenes for a vertical reel. Each scene is a natural chunk of 1 to 3 lines taking about 6 to 9 seconds to recite. Vary the durations to fit the lines. The scenes joined must equal the full poem.`;

  if (!bilingual) {
    prompt += `

Return ONLY valid JSON, no markdown:
{"title":"...","poem":"line1\\nline2","scenes":[{"lines":"line1","seconds":7}]}
Use \\n between lines.`;
  } else {
    prompt += `

ALSO write the SAME poem as proper rhyming, singable lyrics in ${p.lang2}${langNote(p.lang2 as string)}. This is NOT a word-for-word translation: it must rhyme and scan naturally in ${p.lang2} while keeping the same meaning, mood, and the SAME ${p.scenes} scenes so both versions line up scene by scene. For every scene provide "lines" in ${p.lang} and "lines2" in ${p.lang2} that carry the same idea.

Return ONLY valid JSON, no markdown:
{"title":"...","title2":"...","poem":"...","poem2":"...","scenes":[{"lines":"...","lines2":"...","seconds":7}]}
Use \\n between lines.`;
  }
  return prompt;
}

const REWORK_INTROS: Record<"optimize" | "enhance", string> = {
  optimize:
    "Improve the RHYTHM, meter, and rhyme of this children's poem without changing its meaning, topic, length, or reading level.",
  enhance:
    "Enhance this children's poem: make imagery more vivid and playful, add sound-play or a fun refrain, optionally one short stanza. Keep the original idea.",
};

function buildReworkPrompt(p: ReworkParams): string {
  if (p.kind === "regenerate") {
    const existingTitles = [p.current.title, p.current.title2].filter((t): t is string => !!t);
    return buildPoemPrompt({ ...p, avoidTitles: [...(p.avoidTitles ?? []), ...existingTitles] });
  }

  const bilingual = isBilingual(p.lang, p.lang2);
  const intro = REWORK_INTROS[p.kind];
  const bilingualNote = bilingual
    ? `Also keep the ${p.lang2} version as proper rhyming lyrics, same meaning, aligned scene by scene.\nCurrent ${p.lang2} version:\n${p.current.poem2 ?? ""}`
    : "";
  const shape = bilingual
    ? `{"title":"...","title2":"...","poem":"...","poem2":"...","scenes":[{"lines":"...","lines2":"...","seconds":7}]}`
    : `{"title":"...","poem":"...","scenes":[{"lines":"...","seconds":7}]}`;

  return `${intro}
Audience ${p.age}, primary language ${p.lang}. Keep it reel friendly.

Current title: ${p.current.title}
Current poem:
${p.current.poem}
${bilingualNote}
Re-split into exactly ${p.scenes} timed scenes of about 6 to 9 seconds each.

Return ONLY valid JSON, no markdown:
${shape}
Use \\n between lines.`;
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
  const subtitleLine = p.seg.lines2
    ? `\nOn-screen subtitle in ${p.lang2}: "${p.seg.lines2.replace(/\n/g, " / ")}"`
    : "";
  return `Using this master style bible, keep the look 100% consistent:
"""${p.master}"""

Write ONE Google Flow (Veo 3.1) prompt for scene ${p.idx + 1} of ${p.total}, a ${p.seg.dur}-second 9:16 vertical clip.
Spoken/sung audio (${p.lang}): "${p.seg.lines.replace(/\n/g, " / ")}"${subtitleLine}

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
