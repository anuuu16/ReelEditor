export interface ProgressUpdate {
  outTimeSeconds: number;
  done: boolean;
}

function parseTimecode(tc: string): number {
  const match = tc.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

export function createProgressParser(onUpdate: (update: ProgressUpdate) => void): (chunk: string) => void {
  let buffer = "";
  let lastOutTime = 0;

  return function feed(chunk: string) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1).trim();

      if (key === "out_time") {
        lastOutTime = parseTimecode(value);
      } else if (key === "progress") {
        onUpdate({ outTimeSeconds: lastOutTime, done: value === "end" });
      }
    }
  };
}
