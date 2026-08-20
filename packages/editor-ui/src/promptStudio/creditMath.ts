// Mirrors render-service's studioGenerate.ts creditsPerClipForModel exactly — credits per clip is
// determined entirely by the model choice, never a value someone types in by hand.
const MODEL_CREDITS: Record<string, number> = {
  "Veo 3.1 Lite": 10,
  "Veo 3.1 Fast": 20,
  "Veo 3.1 Quality": 100,
};

export function creditsPerClipForModel(model: string): number {
  return MODEL_CREDITS[model] ?? MODEL_CREDITS["Veo 3.1 Lite"];
}

export function clipsPerAccount(creditsPerAccount: number, creditsPerClip: number): number {
  return Math.max(1, Math.floor(creditsPerAccount / creditsPerClip));
}

export function accountsNeeded(numScenes: number, creditsPerAccount: number, creditsPerClip: number): number {
  return Math.max(1, Math.ceil(numScenes / clipsPerAccount(creditsPerAccount, creditsPerClip)));
}

export interface AccountGroupResult {
  account: number;
  sceneRange: [number, number];
  clips: number;
  credits: number;
}

// Mirrors render-service's studioGenerate.ts buildAccounts exactly — a pasted-in scene list from
// an external chat AI is never trusted to have gotten this arithmetic right, so we always compute
// it ourselves from numScenes/creditsPerAccount/creditsPerClip.
export function buildAccounts(numScenes: number, creditsPerAccount: number, creditsPerClip: number): AccountGroupResult[] {
  const perAccount = clipsPerAccount(creditsPerAccount, creditsPerClip);
  const accounts: AccountGroupResult[] = [];
  let sceneN = 1;
  let accountN = 1;
  while (sceneN <= numScenes) {
    const clips = Math.min(perAccount, numScenes - sceneN + 1);
    accounts.push({ account: accountN, sceneRange: [sceneN, sceneN + clips - 1], clips, credits: clips * creditsPerClip });
    sceneN += clips;
    accountN += 1;
  }
  return accounts;
}

export function accountForScene(accounts: AccountGroupResult[], n: number): number {
  return accounts.find((a) => n >= a.sceneRange[0] && n <= a.sceneRange[1])?.account ?? (accounts.length || 1);
}
