import type { RhymeScene } from "./rhymeTypes.js";

// Shape of ElevenLabs' own POST /v1/text-to-speech/:voice_id/with-timestamps response — pasted in
// after the user generates audio from the copy-paste prompt, so real per-character timing from the
// actual generated speech (not a guess) can retime the scenes.
export interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface ElevenLabsTimestampsResponse {
  alignment?: ElevenLabsAlignment;
  normalized_alignment?: ElevenLabsAlignment;
}

function isAlignment(v: unknown): v is ElevenLabsAlignment {
  const a = v as ElevenLabsAlignment | null;
  return (
    !!a &&
    Array.isArray(a.characters) &&
    Array.isArray(a.character_start_times_seconds) &&
    Array.isArray(a.character_end_times_seconds)
  );
}

export function parseElevenLabsAlignment(raw: string): ElevenLabsAlignment {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("That doesn't look like valid JSON — paste ElevenLabs' full API response, or just its \"alignment\" object.");
  }
  if (isAlignment(data)) return data;
  const r = data as ElevenLabsTimestampsResponse;
  if (r && isAlignment(r.alignment)) return r.alignment;
  if (r && isAlignment(r.normalized_alignment)) return r.normalized_alignment;
  throw new Error('Could not find "characters"/"character_start_times_seconds"/"character_end_times_seconds" in the pasted JSON.');
}

// Only letters/digits (any script) count for matching — punctuation, the pause "..." cues, and
// whatever whitespace ElevenLabs' normalization introduces are all noise here, not meaningful
// content to align on.
function isMatchable(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

interface CleanedChar {
  ch: string;
  originalIndex: number;
}

function buildCleanedAlignment(characters: string[]): CleanedChar[] {
  const out: CleanedChar[] = [];
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (isMatchable(ch)) out.push({ ch: ch.toLowerCase(), originalIndex: i });
  }
  return out;
}

function cleanedString(text: string): string {
  return Array.from(text)
    .filter(isMatchable)
    .map((c) => c.toLowerCase())
    .join("");
}

export interface RetimeResult {
  scenes: RhymeScene[];
  matchedCount: number;
  unmatchedCount: number;
}

// Finds each scene's line text as a substring of the actual spoken/aligned audio (in order, so a
// repeated chorus line matches its next real occurrence rather than always the first) and replaces
// that scene's "seconds" with the real elapsed time between its first and last matched character.
// A scene whose text isn't found (mismatched transcription, edited lyrics after generating audio,
// etc.) is left with its existing duration rather than guessed at.
export function retimeScenesFromAlignment(scenes: RhymeScene[], language: string, alignment: ElevenLabsAlignment): RetimeResult {
  const cleaned = buildCleanedAlignment(alignment.characters);
  const cleanedStr = cleaned.map((c) => c.ch).join("");

  let cursor = 0;
  let matchedCount = 0;
  let unmatchedCount = 0;

  const newScenes = scenes.map((scene): RhymeScene => {
    const searchText = cleanedString(scene.lines[language] ?? "");
    if (!searchText) {
      unmatchedCount++;
      return scene;
    }
    const idx = cleanedStr.indexOf(searchText, cursor);
    if (idx === -1) {
      unmatchedCount++;
      return scene;
    }
    const startCleanedIdx = idx;
    const endCleanedIdx = idx + searchText.length - 1;
    const startOriginal = cleaned[startCleanedIdx].originalIndex;
    const endOriginal = cleaned[endCleanedIdx].originalIndex;
    const start = alignment.character_start_times_seconds[startOriginal];
    const end = alignment.character_end_times_seconds[endOriginal];
    cursor = endCleanedIdx + 1;
    matchedCount++;
    return { ...scene, seconds: Math.max(0.1, end - start) };
  });

  return { scenes: newScenes, matchedCount, unmatchedCount };
}
