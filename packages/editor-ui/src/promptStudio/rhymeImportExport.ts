import type { RhymePoem, RhymePoemParams, RhymeReel } from "./rhymeTypes.js";

// A copy-paste-ready prompt for any AI chat, mirroring render-service's own poem prompt, so
// whatever comes back matches the Poem JSON shape this app already knows how to import.
export function buildRhymePoemPromptTemplate(p: RhymePoemParams): string {
  const languages = p.languages.length ? p.languages : ["English"];
  const languageInstruction =
    languages.length === 1
      ? `Primary language: ${languages[0]}.`
      : `Write it in EVERY one of these languages at once, independently, not translations of each other: ${languages.join(", ")}. Each language's version must rhyme and scan naturally on its own while keeping the same meaning, mood, and the SAME ${p.scenes} scenes, so every language lines up scene by scene.`;

  const titles = languages.map((l) => `"${l}":"..."`).join(",");
  const poems = languages.map((l) => `"${l}":"line1\\nline2"`).join(",");
  const sceneLines = languages.map((l) => `"${l}":"line1"`).join(",");

  return `You are a beloved children's poet writing for short-form video reels.

Topic: ${p.topic}
Audience: ${p.age}
Type: ${p.style}
Length: about ${p.lengthSeconds} seconds total when read aloud
${languageInstruction}
${p.extra ? `Extra direction: ${p.extra}` : ""}

Write the poem with strong sing-song rhythm and clean rhyme in every language above. Then split it into exactly ${p.scenes} timed scenes for a reel. Each scene is a natural chunk of 1 to 3 lines taking about 6 to 9 seconds to recite, with every language's scene lines carrying the same idea at the same point. The scenes joined must equal the full poem, in every language.

Return ONLY valid JSON, no markdown, with a "titles" object, a "poems" object, and a "scenes" array, each keyed by the exact language names above:
{"titles":{${titles}},"poems":{${poems}},"scenes":[{"lines":{${sceneLines}},"seconds":7}]}
Use \\n between lines within a poem string.`;
}

function stripCodeFences(text: string): string {
  return text.replace(/```json/gi, "```").replace(/```/g, "");
}

function extractJsonObject(raw: string): unknown {
  const stripped = stripCodeFences(raw).trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in the pasted text");
  }
  const slice = stripped.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return JSON.parse(slice.replace(/\r/g, ""));
  }
}

export function parseRhymePoemJson(raw: string): RhymePoem {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = extractJsonObject(raw) as any;
  if (!d || typeof d.poems !== "object" || d.poems === null || !Array.isArray(d.scenes)) {
    throw new Error('Pasted JSON must have a "poems" object and a "scenes" array');
  }
  const titles: Record<string, string> = typeof d.titles === "object" && d.titles !== null ? d.titles : {};
  const poems: Record<string, string> = d.poems;
  return {
    titles,
    poems,
    scenes: d.scenes.map((s: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scene = s as any;
      const lines: Record<string, string> =
        scene?.lines && typeof scene.lines === "object" ? scene.lines : { [Object.keys(poems)[0] ?? "English"]: String(scene?.lines ?? "") };
      return {
        lines,
        seconds: Number.isFinite(scene?.seconds) ? Number(scene.seconds) : 8,
      };
    }),
  };
}

export interface RhymeReelPromptParams {
  title: string;
  topic: string;
  age: string;
  poemText: string;
  /** The reel language's timed scenes, in order — the external AI writes one Flow prompt per
   * entry, same count and order, it doesn't invent its own split. */
  scenes: Array<{ lines: string; seconds: number }>;
  /** e.g. "9:16", "16:9", "1:1" — the project's actual canvas shape (Settings > Aspect ratio). */
  aspectRatio?: string;
}

// "9:16" -> "9:16 vertical", "16:9" -> "16:9 landscape", "1:1" -> "1:1 square", anything else
// (e.g. "4:5") passed through with no orientation word rather than guessing wrong — mirrors
// render-service's own aspectRatioLabel() in rhymeGenerate.ts.
function aspectRatioLabel(aspectRatio?: string): string {
  const ratio = aspectRatio || "9:16";
  if (ratio === "9:16") return "9:16 vertical";
  if (ratio === "16:9") return "16:9 landscape";
  if (ratio === "1:1") return "1:1 square";
  return ratio;
}

// Mirrors render-service's own master/character/cover/scene/caption prompts, but combined into
// one request (rather than five separate round trips) since that's what a copy-paste workflow
// into an external chat AI actually wants.
export function buildRhymeReelPromptTemplate(p: RhymeReelPromptParams): string {
  const sceneList = p.scenes.map((s, i) => `Scene ${i + 1} (${s.seconds}s): "${s.lines.replace(/\n/g, " / ")}"`).join("\n");
  const aspect = aspectRatioLabel(p.aspectRatio);

  return `You are a prompt engineer for Google Flow (Veo 3.1) ${aspect} kids reels, and a social caption writer.

Title: ${p.title || "(untitled)"}
Topic: ${p.topic || "(see lyrics below)"}
Audience: ${p.age}

Full lyrics, for context on the story/imagery:
"""${p.poemText}"""

Scenes (already timed — write exactly one prompt per scene below, same order, do not add, remove, or reorder scenes):
${sceneList}

Write:
1. A MASTER SETUP PROMPT: a detailed, reusable style bible in full sentences, 3D animated (Pixar/DreamWorks-style rendering — rounded, dimensional, soft-shaded, NOT 2D/flat/vector), covering animation style, color palette + mood/lighting, the main character's design, recurring setting details, and on-screen text style. Every other prompt below must copy this verbatim as their shared anchor.
2. A CHARACTER REFERENCE prompt: one self-contained Google Flow prompt for a clean turnaround/reference image of the main character alone on a plain background, matching the master exactly.
3. A COVER/THUMBNAIL prompt: one Google Flow / image-gen prompt for an eye-catching ${aspect} cover (character in an appealing pose reflecting the story, bold title-text treatment described not literal words, bright colors, reads well as a small thumbnail), matching the master.
4. One Google Flow prompt per scene listed above, same count and order, each a ${aspect} clip describing the visual action/camera move/character for that scene's lines, consistent with the master — self-contained, ready to paste.
5. A short Instagram Reel / YouTube Short caption plus 8 to 12 hashtags.

Return ONLY valid JSON, no markdown:
{"master":"...","characterPrompt":"...","coverPrompt":"...","scenePrompts":["...","..."],"caption":"..."}`;
}

export function parseRhymeReelJson(raw: string): RhymeReel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = extractJsonObject(raw) as any;
  if (!d || typeof d.master !== "string" || !Array.isArray(d.scenePrompts)) {
    throw new Error('Pasted JSON must have a "master" string and a "scenePrompts" array');
  }
  return {
    master: d.master,
    characterPrompt: typeof d.characterPrompt === "string" ? d.characterPrompt : undefined,
    coverPrompt: typeof d.coverPrompt === "string" ? d.coverPrompt : undefined,
    scenePrompts: d.scenePrompts.map((s: unknown) => String(s)),
    caption: typeof d.caption === "string" ? d.caption : "",
  };
}
