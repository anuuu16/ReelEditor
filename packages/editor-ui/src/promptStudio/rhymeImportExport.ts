import type { RhymePoem, RhymePoemParams } from "./rhymeTypes.js";

// A copy-paste-ready prompt for any AI chat, mirroring render-service's own poem prompt, so
// whatever comes back matches the Poem JSON shape this app already knows how to import.
export function buildRhymePoemPromptTemplate(p: RhymePoemParams): string {
  const bilingual = !!p.lang2 && p.lang2 !== "None" && p.lang2 !== p.lang;

  let prompt = `You are a beloved children's poet writing for short vertical video reels.

Topic: ${p.topic}
Audience: ${p.age}
Type: ${p.style}
Length: about ${p.lines} lines
Primary language: ${p.lang}
${p.extra ? `Extra direction: ${p.extra}` : ""}

Write the poem with strong sing-song rhythm and clean rhyme. Then split it into exactly ${p.scenes} timed scenes for a vertical reel. Each scene is a natural chunk of 1 to 3 lines taking about 6 to 9 seconds to recite. Vary the durations to fit the lines. The scenes joined must equal the full poem.`;

  if (!bilingual) {
    prompt += `

Return ONLY valid JSON, no markdown:
{"title":"...","poem":"line1\\nline2","scenes":[{"lines":"line1","seconds":7}]}
Use \\n between lines.`;
  } else {
    prompt += `

ALSO write the SAME poem as proper rhyming, singable lyrics in ${p.lang2}. This is NOT a word-for-word translation, it must rhyme and scan naturally in ${p.lang2} while keeping the same meaning, mood, and the SAME ${p.scenes} scenes so both versions line up scene by scene.

Return ONLY valid JSON, no markdown:
{"title":"...","title2":"...","poem":"...","poem2":"...","scenes":[{"lines":"...","lines2":"...","seconds":7}]}
Use \\n between lines.`;
  }
  return prompt;
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
  if (!d || typeof d.poem !== "string" || !Array.isArray(d.scenes)) {
    throw new Error('Pasted JSON must have a "poem" string and a "scenes" array');
  }
  return {
    title: typeof d.title === "string" ? d.title : "Untitled poem",
    title2: typeof d.title2 === "string" ? d.title2 : undefined,
    poem: d.poem,
    poem2: typeof d.poem2 === "string" ? d.poem2 : undefined,
    scenes: d.scenes.map((s: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scene = s as any;
      return {
        lines: typeof scene?.lines === "string" ? scene.lines : "",
        lines2: typeof scene?.lines2 === "string" ? scene.lines2 : undefined,
        seconds: Number.isFinite(scene?.seconds) ? Number(scene.seconds) : 8,
      };
    }),
  };
}
