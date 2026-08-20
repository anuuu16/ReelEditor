import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// Which LLM actually answers generation requests, "openai" (default, since an Anthropic key isn't
// always on hand) or "anthropic" (switch LLM_PROVIDER back to this the moment one is available).
// Both implementations stay in this one file, so switching back is a one-line env change, not a
// rewrite, and every feature that generates text (Prompt Studio, Rhyme Studio) shares one client.
export function currentProvider(): "openai" | "anthropic" {
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

let openaiClient: OpenAI | null = null;
function getOpenAiClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set (LLM_PROVIDER=openai)");
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

const DEFAULT_MAX_TOKENS = process.env.LLM_MAX_TOKENS ? Number(process.env.LLM_MAX_TOKENS) : 2000;

async function callAnthropic(system: string, userMessage: string): Promise<string> {
  const response = await getAnthropicClient().messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: DEFAULT_MAX_TOKENS,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

async function callOpenAi(system: string, userMessage: string): Promise<string> {
  const response = await getOpenAiClient().chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMessage },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}

// First brace to last brace, JSON.parse, with a fallback retry that strips carriage returns
// (a model occasionally emits CRLF inside a string that breaks a naive parse).
export function extractJson<T>(text: string): T {
  const stripped = text.replace(/```json/gi, "```").replace(/```/g, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in model output");
  }
  const slice = stripped.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch {
    return JSON.parse(slice.replace(/\r/g, "")) as T;
  }
}

// Calls the current provider, extracts and validates the JSON shape, and retries up to `attempts`
// times (a fresh model call each time, not just a re-parse) before giving up.
export async function callLlmJson<T>(system: string, userMessage: string, validate: (o: unknown) => boolean, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const text = currentProvider() === "anthropic" ? await callAnthropic(system, userMessage) : await callOpenAi(system, userMessage);
      const parsed = extractJson<T>(text);
      if (!validate(parsed)) throw new Error("Model output was missing expected fields");
      return parsed;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
