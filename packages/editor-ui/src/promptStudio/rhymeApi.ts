import { RENDER_SERVICE_URL } from "../constants.js";
import type {
  RhymePoem,
  RhymePoemParams,
  RhymeReelCaptionParams,
  RhymeReelCharacterParams,
  RhymeReelCoverParams,
  RhymeReelMasterParams,
  RhymeReelSceneParams,
  RhymeReworkParams,
} from "./rhymeTypes.js";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${RENDER_SERVICE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Generation failed" }));
    throw new Error(err.error ?? "Generation failed");
  }
  return response.json();
}

export function generateRhymePoem(params: RhymePoemParams): Promise<RhymePoem> {
  return postJson<RhymePoem>("/rhyme/poem", params);
}

export function reworkRhymePoem(params: RhymeReworkParams): Promise<RhymePoem> {
  return postJson<RhymePoem>("/rhyme/poem/rework", params);
}

export function generateRhymeReelMaster(params: RhymeReelMasterParams): Promise<{ master: string }> {
  return postJson<{ master: string }>("/rhyme/reel/master", params);
}

export function generateRhymeReelScene(params: RhymeReelSceneParams): Promise<{ prompt: string }> {
  return postJson<{ prompt: string }>("/rhyme/reel/scene", params);
}

export function generateRhymeReelCaption(params: RhymeReelCaptionParams): Promise<{ caption: string }> {
  return postJson<{ caption: string }>("/rhyme/reel/caption", params);
}

export function generateRhymeReelCharacter(params: RhymeReelCharacterParams): Promise<{ prompt: string }> {
  return postJson<{ prompt: string }>("/rhyme/reel/character", params);
}

export function generateRhymeReelCover(params: RhymeReelCoverParams): Promise<{ prompt: string }> {
  return postJson<{ prompt: string }>("/rhyme/reel/cover", params);
}
