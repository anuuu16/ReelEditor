import type { RhymePoem, RhymePoemParams } from "./rhymeTypes.js";

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

  return `You are a beloved children's poet writing for short vertical video reels.

Topic: ${p.topic}
Audience: ${p.age}
Type: ${p.style}
Length: about ${p.lengthSeconds} seconds total when read aloud
${languageInstruction}
${p.extra ? `Extra direction: ${p.extra}` : ""}

Write the poem with strong sing-song rhythm and clean rhyme in every language above. Then split it into exactly ${p.scenes} timed scenes for a vertical reel. Each scene is a natural chunk of 1 to 3 lines taking about 6 to 9 seconds to recite, with every language's scene lines carrying the same idea at the same point. The scenes joined must equal the full poem, in every language.

Return ONLY valid JSON, no markdown, with a "titles" object, a "poems" object, and a "scenes" array, each keyed by the exact language names above:
{"titles":{${titles}},"poems":{${poems}},"scenes":[{"lines":{${sceneLines}},"seconds":7}]}
Use \\n between lines within a poem string.`;
}

function stripCodeFences(text: string): string {
  return text.replace(/```json/gi, "```").replace(/```/g, "");
}

export function parseRhymePoemJson(raw: string): RhymePoem {
  const stripped = stripCodeFences(raw).trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in the pasted text");
  }
  const slice = stripped.slice(start, end + 1);
  let data: unknown;
  try {
    data = JSON.parse(slice);
  } catch {
    data = JSON.parse(slice.replace(/\r/g, ""));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
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
