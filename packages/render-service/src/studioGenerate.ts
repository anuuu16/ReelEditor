import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { StudioAccountGroup, StudioScene } from "./studioProjects.js";

// Generation is a convenience, not the only way in — a Studio project's poem/prompts can equally be
// pasted in by hand from any chat UI, so nothing downstream may assume this path was used.

export interface GenerateParams {
  topic: string;
  videoType: "reel" | "full_video";
  platform: string;
  numScenes: number;
  style: string;
  lang: string;
  ownAudio: boolean;
  extra: string;
  model: string;
  creditsPerAccount: number;
}

export interface BaseResult {
  concept: string;
  hook: string;
  master_prompt: string;
  caption: string;
  hashtags: string[];
}

export interface SceneResult {
  title: string;
  shot: string;
  duration: string;
  prompt: string;
  audio: string;
}

const MODEL_CREDITS: Record<string, number> = {
  "Veo 3.1 Lite": 10,
  "Veo 3.1 Fast": 20,
  "Veo 3.1 Quality": 100,
};

export class StudioValidationError extends Error {}

export function creditsPerClipForModel(model: string): number {
  const credits = MODEL_CREDITS[model];
  if (credits === undefined) {
    throw new StudioValidationError(`Unknown model "${model}". Expected one of: ${Object.keys(MODEL_CREDITS).join(", ")}`);
  }
  return credits;
}

export function aspectAndFormat(videoType: "reel" | "full_video"): { aspect: string; formatDesc: string } {
  if (videoType === "reel") {
    return { aspect: "9:16 vertical", formatDesc: "a short vertical reel for Instagram Reels and YouTube Shorts" };
  }
  if (videoType === "full_video") {
    return { aspect: "16:9 landscape", formatDesc: "a full landscape video for YouTube" };
  }
  throw new StudioValidationError(`Unknown videoType "${videoType}". Expected "reel" or "full_video".`);
}

export function audioLine(ownAudio: boolean): string {
  return ownAudio
    ? "The user will add a separate music or voice track later, so do not generate spoken dialogue or singing voices, only light ambient sound. Characters express themselves through facial expressions and body movement, not speech."
    : "Use Veo 3.1 native audio: ambient sound, sound effects, music, and spoken dialogue in quotes where it fits.";
}

export function buildAccounts(numScenes: number, creditsPerClip: number, creditsPerAccount: number): StudioAccountGroup[] {
  const clipsPerAccount = Math.max(1, Math.floor(creditsPerAccount / creditsPerClip));
  const accounts: StudioAccountGroup[] = [];
  let sceneN = 1;
  let accountN = 1;
  while (sceneN <= numScenes) {
    const clips = Math.min(clipsPerAccount, numScenes - sceneN + 1);
    accounts.push({
      account: accountN,
      sceneRange: [sceneN, sceneN + clips - 1],
      clips,
      credits: clips * creditsPerClip,
    });
    sceneN += clips;
    accountN += 1;
  }
  return accounts;
}

export function namingConvention(numScenes: number): string {
  return `scene_01 to scene_${String(numScenes).padStart(2, "0")}`;
}

function buildBaseSystemPrompt(p: { aspect: string; formatDesc: string; audioLine: string; numScenes: number }): string {
  return `You are an expert AI video prompt engineer for Google Flow, powered by Veo 3.1. You are creating ${p.formatDesc} made of ${p.numScenes} scenes.

How Flow works, respect this: each generated clip is about 8 seconds, so this piece is built as ${p.numScenes} separate clips. The user generates them in numbered order, scene 1 first, then scene 2, then scene 3, and so on up to scene ${p.numScenes}, then joins them on the timeline in that same order. Consistency is critical, so every recurring character, wardrobe, prop, setting, color grade, and visual style must be described with identical wording in every scene. Never write "same as before". Every scene prompt must stand alone. Aspect ratio ${p.aspect}. ${p.audioLine}

Write a strong, proper master setup prompt (the style bible) that the user pastes into Flow first. Written as clean natural language, no markdown headers, it must clearly state:
1. the concept, and that this is a ${p.numScenes} scene sequence rendered as ${p.numScenes} separate ${p.aspect} clips of about 8 seconds each, generated and joined in numbered order from scene 1 to scene ${p.numScenes}.
2. the exact visual style, film look, and color grade.
3. full descriptions of every recurring character and key object, with fixed names, colors, and proportions, so they stay identical across all clips.
4. the setting and overall mood.
5. the audio approach.
6. a clip naming convention, instructing that each generated clip is saved with its two digit scene number, from scene_01 up to scene_${p.numScenes}, so the clips stay in the correct order across all accounts when downloaded and joined.
7. a final instruction telling Flow to keep every numbered clip consistent with this bible.
Do not describe individual scene actions in the master prompt.

Never use em dashes, use commas or periods or "and" or "but".
Return ONLY valid JSON, no markdown, no backticks, exactly this shape:
{"concept":"one line concept","hook":"on screen text hook for the first 2 seconds","master_prompt":"the full master setup prompt as described above","caption":"platform ready caption","hashtags":["tag1","tag2","tag3","tag4","tag5","tag6"]}`;
}

function buildSceneSystemPrompt(p: { aspect: string; audioLine: string }): string {
  return `You are an expert AI video prompt engineer for Google Flow, powered by Veo 3.1. Write ONE numbered scene of about 8 seconds for a ${p.aspect} video that is one clip inside a larger numbered sequence.
The scene prompt must be a full, self contained, copy paste ready Flow prompt with camera and camera movement, subject with specific visual detail, action, setting, lighting, mood, visual style, and audio. Reuse the exact recurring descriptors from the master prompt so this clip stays visually consistent with every other clip. It should continue logically from the previous scene and lead into the next. ${p.audioLine} Keep it rich but under about 85 words. Never use em dashes.
Return ONLY valid JSON, no markdown, no backticks, exactly this shape:
{"title":"short scene title","shot":"shot type","duration":"~8s","prompt":"the full Flow prompt","audio":"one line audio summary"}`;
}

function buildBaseUserMessage(params: GenerateParams): string {
  return `Topic: ${params.topic}
Video type: ${params.videoType} (${aspectAndFormat(params.videoType).aspect})
Platform: ${params.platform}
Total scenes: ${params.numScenes} (about ${params.numScenes * 8} seconds total)
Visual style: ${params.style}
Dialogue or voiceover language: ${params.lang}
Own audio track: ${params.ownAudio ? "yes, keep visuals speech free" : "no, Flow generates audio"}
Extra direction: ${params.extra || "none"}

Write the base setup: concept, hook, master prompt, caption, and hashtags.`;
}

function buildSceneUserMessage(params: GenerateParams, i: number, masterPrompt: string, concept: string): string {
  const { aspect } = aspectAndFormat(params.videoType);
  return `Topic: ${params.topic}
Video type: ${params.videoType} (${aspect})
Platform: ${params.platform}
Total scenes in the piece: ${params.numScenes} (about ${params.numScenes * 8} seconds total)
Visual style: ${params.style}
Dialogue or voiceover language: ${params.lang}
Own audio track: ${params.ownAudio ? "yes, keep visuals speech free" : "no, Flow generates audio"}
Extra direction: ${params.extra || "none"}

Master prompt already written:
"""${masterPrompt}"""

Concept: ${concept}

Write scene ${i} of ${params.numScenes}. It should advance the piece logically and stay visually consistent with the master prompt.`;
}

function extractJson<T>(text: string): T {
  const stripped = text.replace(/```json/gi, "```").replace(/```/g, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in model output");
  }
  return JSON.parse(stripped.slice(start, end + 1)) as T;
}

// Which LLM actually answers /studio/:id/generate — "openai" (default, since an Anthropic key
// isn't always on hand) or "anthropic" (switch LLM_PROVIDER back to this the moment one is).
// Both implementations stay in this file so switching back is a one-line env change, not a rewrite.
function currentProvider(): "openai" | "anthropic" {
  return (process.env.LLM_PROVIDER || "openai").toLowerCase() === "anthropic" ? "anthropic" : "openai";
}

let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (LLM_PROVIDER=anthropic)");
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

async function callAnthropicJson<T>(system: string, userMessage: string): Promise<T> {
  const response = await getAnthropicClient().messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  return extractJson<T>(text);
}

let openaiClient: OpenAI | null = null;
function getOpenAiClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set (LLM_PROVIDER=openai)");
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

async function callOpenAiJson<T>(system: string, userMessage: string): Promise<T> {
  const response = await getOpenAiClient().chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMessage },
    ],
  });
  const text = response.choices[0]?.message?.content ?? "";
  return extractJson<T>(text);
}

async function callLlmJson<T>(system: string, userMessage: string, attempts = 3): Promise<T> {
  const call = currentProvider() === "anthropic" ? callAnthropicJson<T> : callOpenAiJson<T>;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await call(system, userMessage);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function runBaseCall(params: GenerateParams): Promise<BaseResult> {
  const { aspect, formatDesc } = aspectAndFormat(params.videoType);
  const system = buildBaseSystemPrompt({ aspect, formatDesc, audioLine: audioLine(params.ownAudio), numScenes: params.numScenes });
  return callLlmJson<BaseResult>(system, buildBaseUserMessage(params));
}

function blankScene(n: number): SceneResult {
  return { title: `Scene ${n} (edit me)`, shot: "", duration: "~8s", prompt: "", audio: "" };
}

export async function runSceneCall(params: GenerateParams, i: number, masterPrompt: string, concept: string): Promise<SceneResult> {
  const { aspect } = aspectAndFormat(params.videoType);
  const system = buildSceneSystemPrompt({ aspect, audioLine: audioLine(params.ownAudio) });
  const userMessage = buildSceneUserMessage(params, i, masterPrompt, concept);
  try {
    return await callLlmJson<SceneResult>(system, userMessage);
  } catch {
    // A single scene failing after all retries must not sink the whole generation — the person
    // gets a numbered, empty, still-editable slot instead of a fatal error mid-stream.
    return blankScene(i);
  }
}

function timeRange(sceneIndex: number): { timeStart: string; timeEnd: string } {
  const startSec = sceneIndex * 8;
  const endSec = startSec + 8;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return { timeStart: fmt(startSec), timeEnd: fmt(endSec) };
}

export type GenerateEvent =
  | { type: "base"; data: BaseResult }
  | { type: "scene"; data: { progressLabel: string; scene: StudioScene } }
  | { type: "done"; data: { base: BaseResult; scenes: StudioScene[]; accounts: StudioAccountGroup[] } }
  | { type: "error"; data: { message: string } };

export async function* generateStudioProject(params: GenerateParams): AsyncGenerator<GenerateEvent> {
  const creditsPerClip = creditsPerClipForModel(params.model);
  const accounts = buildAccounts(params.numScenes, creditsPerClip, params.creditsPerAccount);
  const accountForScene = (n: number) => accounts.find((a) => n >= a.sceneRange[0] && n <= a.sceneRange[1])?.account ?? accounts.length;

  let base: BaseResult;
  try {
    base = await runBaseCall(params);
  } catch (err) {
    yield { type: "error", data: { message: err instanceof Error ? err.message : String(err) } };
    return;
  }
  yield { type: "base", data: base };

  const scenes: StudioScene[] = [];
  for (let n = 1; n <= params.numScenes; n++) {
    const result = await runSceneCall(params, n, base.master_prompt, base.concept);
    const { timeStart, timeEnd } = timeRange(n - 1);
    const scene: StudioScene = {
      n,
      clipName: `scene_${String(n).padStart(2, "0")}`,
      account: accountForScene(n),
      title: result.title,
      timeStart,
      timeEnd,
      durationSeconds: 8,
      shot: result.shot,
      audio: result.audio,
      prompt: result.prompt,
    };
    scenes.push(scene);
    yield { type: "scene", data: { progressLabel: `Writing scene ${n} of ${params.numScenes}`, scene } };
  }

  yield { type: "done", data: { base, scenes, accounts } };
}
