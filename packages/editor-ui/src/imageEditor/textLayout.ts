import { fontStack, type TextLayer } from "./document.js";

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureContext(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
    if (!measureCtx) throw new Error("2D canvas is not available");
  }
  return measureCtx;
}

export function textFont(layer: TextLayer, canvasWidth: number): string {
  const px = Math.max(1, layer.fontSize * canvasWidth);
  return `${layer.italic ? "italic " : ""}${layer.bold ? "700" : "400"} ${px}px ${fontStack(layer.fontFamily)}`;
}

export interface TextLayout {
  lines: string[];
  fontPx: number;
  lineHeightPx: number;
  paddingPx: number;
  /** Box size in canvas pixels — width is the layer's, height grows with the wrapped text. */
  width: number;
  height: number;
}

function wrapLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

/** Word-wraps a text layer inside its box width; the box height is whatever the text needs. */
export function layoutText(layer: TextLayer, canvasWidth: number): TextLayout {
  const ctx = getMeasureContext();
  ctx.font = textFont(layer, canvasWidth);
  const fontPx = Math.max(1, layer.fontSize * canvasWidth);
  const lineHeightPx = fontPx * layer.lineHeight;
  const paddingPx = layer.padding * canvasWidth;
  const width = Math.max(fontPx, layer.width * canvasWidth);
  const innerWidth = Math.max(1, width - paddingPx * 2);
  const lines = layer.text.split(/\r?\n/).flatMap((paragraph) => wrapLine(ctx, paragraph, innerWidth));
  const height = lines.length * lineHeightPx + paddingPx * 2;
  return { lines, fontPx, lineHeightPx, paddingPx, width, height };
}
