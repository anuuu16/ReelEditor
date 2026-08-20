// A tiny hand-rolled SSE reader. `EventSource` cannot send a POST body, and the generate endpoint
// needs one, so this reads `response.body` as a stream instead, decodes it as UTF-8, splits on
// blank lines into frames, and parses each frame's `event:`/`data:` lines.

export interface StreamStudioGenerateHandlers {
  onEvent(type: string, data: unknown): void;
}

function parseFrame(rawFrame: string, onEvent: (type: string, data: unknown) => void): void {
  let eventType = "message";
  const dataLines: string[] = [];
  for (const line of rawFrame.split("\n")) {
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (dataLines.length === 0) return;
  try {
    const data = JSON.parse(dataLines.join("\n"));
    onEvent(eventType, data);
  } catch {
    // A malformed frame is dropped rather than crashing the whole stream read.
  }
}

export async function streamStudioGenerate(
  url: string,
  body: unknown,
  handlers: StreamStudioGenerateHandlers
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    const failure = await response.json().catch(() => ({ error: "Generation failed to start" }));
    throw new Error(failure.error ?? "Generation failed to start");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawFrame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      parseFrame(rawFrame, handlers.onEvent);
    }
  }

  if (buffer.trim()) parseFrame(buffer, handlers.onEvent);
}
