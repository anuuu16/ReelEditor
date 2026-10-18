import { NEUTRAL_FILTER } from "@reel-studio/timeline-core";
import type { SavedImageTemplate } from "../persistence/db.js";
import {
  createShapeLayer,
  createTextLayer,
  extractTemplateConfig,
  NEUTRAL_EXTRAS,
  type ImageDocument,
  type Layer,
  type TemplateConfig,
} from "./document.js";

/** A template as the UI sees it — built-ins and user-saved ones share this shape. */
export interface ImageTemplate {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  createdAt: number;
  thumbnailDataUrl: string | null;
  config: TemplateConfig;
  /** Blobs for any image layers / background image the template carries, keyed by media id. */
  media: Record<string, Blob>;
}

const BASE_CONFIG: Omit<TemplateConfig, "canvas" | "layers"> = {
  background: { mode: "solid", color: "#000000", blur: 24, mediaId: null },
  frame: { borderWidth: 0, borderColor: "#ffffff", cornerRadius: 0, matte: null },
  watermark: { text: "", sizeRatio: 0.05, color: "#ffffff", opacity: 0.8, position: "bottom-right" },
  photo: { fitMode: "fit", zoom: 1, offsetX: 0, offsetY: 0, filter: NEUTRAL_FILTER, extras: NEUTRAL_EXTRAS },
};

type BuiltInConfig = Partial<Omit<TemplateConfig, "canvas" | "photo">> &
  Pick<TemplateConfig, "canvas"> & { photo?: Partial<TemplateConfig["photo"]> };

function builtIn(id: string, name: string, description: string, config: BuiltInConfig): ImageTemplate {
  return {
    id: `builtin:${id}`,
    name,
    description,
    builtIn: true,
    createdAt: 0,
    thumbnailDataUrl: null,
    media: {},
    config: {
      ...BASE_CONFIG,
      ...config,
      layers: config.layers ?? [],
      photo: { ...BASE_CONFIG.photo, ...config.photo },
    },
  };
}

export const BUILT_IN_TEMPLATES: ImageTemplate[] = [
  builtIn("ig-story", "Instagram Story", "9:16, photo fills the frame, headline + handle over a dark bottom band.", {
    canvas: { aspectId: "9:16", width: 1080, height: 1920 },
    photo: { fitMode: "fill" },
    layers: [
      createShapeLayer("rectangle", {
        id: "band",
        name: "Bottom band",
        x: 0.5,
        y: 0.87,
        width: 1,
        height: 0.3,
        fill: "rgba(0,0,0,0.55)",
        cornerRadius: 0,
        locked: true,
      }),
      createShapeLayer("line", {
        id: "accent",
        name: "Accent line",
        x: 0.5,
        y: 0.755,
        width: 0.12,
        height: 0.004,
        stroke: "#f2a65a",
        strokeWidth: 0.004,
      }),
      createTextLayer({ id: "title", name: "Headline", text: "Your headline here", x: 0.5, y: 0.83, width: 0.86, fontSize: 0.075 }),
      createTextLayer({
        id: "subtitle",
        name: "Handle",
        text: "@yourhandle",
        x: 0.5,
        y: 0.915,
        width: 0.8,
        fontSize: 0.034,
        bold: false,
        color: "#f2a65a",
        shadow: null,
      }),
      createTextLayer({
        id: "brand",
        name: "Top label",
        text: "NEW STORY",
        x: 0.5,
        y: 0.06,
        width: 0.5,
        fontSize: 0.028,
        fontFamily: "rounded",
        color: "#ffffff",
        background: "rgba(0,0,0,0.45)",
        backgroundRadius: 0.05,
        padding: 0.015,
        shadow: null,
      }),
    ],
  }),

  builtIn("polaroid", "Polaroid", "4:5 instant-photo look: white frame, photo pulled up, handwritten caption.", {
    canvas: { aspectId: "4:5", width: 1080, height: 1350 },
    background: { mode: "solid", color: "#fbfaf7", blur: 24, mediaId: null },
    photo: {
      fitMode: "fit",
      zoom: 0.84,
      offsetX: 0,
      offsetY: -0.06,
      filter: { preset: "vintage", brightness: -0.05, contrast: 0.9, saturation: 0.7, hue: 6 },
    },
    layers: [
      createTextLayer({
        id: "caption",
        name: "Caption",
        text: "summer, somewhere",
        x: 0.5,
        y: 0.9,
        width: 0.8,
        fontSize: 0.06,
        fontFamily: "script",
        bold: false,
        color: "#3b3a36",
        shadow: null,
      }),
    ],
  }),

  builtIn("ig-square", "Instagram Post", "1:1 with a blurred copy of the photo behind it and a caption pill.", {
    canvas: { aspectId: "1:1", width: 1080, height: 1080 },
    background: { mode: "blur", color: "#000000", blur: 32, mediaId: null },
    frame: { borderWidth: 0, borderColor: "#ffffff", cornerRadius: 0, matte: null },
    layers: [
      createTextLayer({
        id: "caption",
        name: "Caption",
        text: "Caption goes here",
        x: 0.26,
        y: 0.92,
        width: 0.44,
        fontSize: 0.034,
        align: "left",
        background: "rgba(0,0,0,0.6)",
        backgroundRadius: 0.04,
        padding: 0.018,
        shadow: null,
      }),
    ],
    watermark: { text: "© your name", sizeRatio: 0.03, color: "#ffffff", opacity: 0.7, position: "bottom-right" },
  }),

  builtIn("yt-thumb", "YouTube Thumbnail", "16:9, loud outlined title, a red tag and an arrow.", {
    canvas: { aspectId: "16:9", width: 1920, height: 1080 },
    photo: { fitMode: "fill", filter: { preset: null, brightness: 0, contrast: 1.1, saturation: 1.25, hue: 0 } },
    layers: [
      createTextLayer({
        id: "title",
        name: "Title",
        text: "BIG\nTITLE",
        x: 0.3,
        y: 0.45,
        width: 0.5,
        fontSize: 0.12,
        fontFamily: "display",
        align: "left",
        lineHeight: 1.0,
        color: "#ffee58",
        outlineColor: "#000000",
        outlineWidth: 0.006,
        shadow: { color: "rgba(0,0,0,0.6)", blur: 0.012, offsetX: 0, offsetY: 0.005 },
      }),
      createShapeLayer("rectangle", {
        id: "tag",
        name: "Tag",
        x: 0.13,
        y: 0.86,
        width: 0.16,
        height: 0.1,
        fill: "#e53935",
        cornerRadius: 0.01,
      }),
      createTextLayer({
        id: "tag-text",
        name: "Tag text",
        text: "NEW",
        x: 0.13,
        y: 0.86,
        width: 0.16,
        fontSize: 0.045,
        fontFamily: "display",
        shadow: null,
      }),
      createShapeLayer("arrow", {
        id: "arrow",
        name: "Arrow",
        x: 0.62,
        y: 0.6,
        width: 0.2,
        height: 0.012,
        rotation: -25,
        stroke: "#ffffff",
        strokeWidth: 0.01,
      }),
    ],
  }),

  builtIn("quote", "Quote card", "1:1, photo dimmed to a backdrop for a centred serif quote, rounded corners on white.", {
    canvas: { aspectId: "1:1", width: 1080, height: 1080 },
    background: { mode: "solid", color: "#000000", blur: 24, mediaId: null },
    frame: { borderWidth: 0, borderColor: "#ffffff", cornerRadius: 12, matte: "#ffffff" },
    photo: { fitMode: "fill", filter: { preset: null, brightness: -0.3, contrast: 0.95, saturation: 0.5, hue: 0 } },
    layers: [
      createTextLayer({
        id: "quote",
        name: "Quote",
        text: "“The best way to predict the future is to create it.”",
        x: 0.5,
        y: 0.47,
        width: 0.78,
        fontSize: 0.058,
        fontFamily: "serif",
        bold: false,
        italic: true,
        lineHeight: 1.35,
        shadow: { color: "rgba(0,0,0,0.6)", blur: 0.01, offsetX: 0, offsetY: 0.004 },
      }),
      createShapeLayer("line", {
        id: "rule",
        name: "Rule",
        x: 0.5,
        y: 0.64,
        width: 0.1,
        height: 0.003,
        stroke: "#ffffff",
        strokeWidth: 0.003,
      }),
      createTextLayer({
        id: "author",
        name: "Author",
        text: "— AUTHOR NAME",
        x: 0.5,
        y: 0.7,
        width: 0.6,
        fontSize: 0.028,
        bold: false,
        color: "#e6e6e9",
        shadow: null,
      }),
    ],
  }),

  builtIn("sale", "Sale badge", "4:5 product card on a warm backdrop with a starburst offer badge.", {
    canvas: { aspectId: "4:5", width: 1080, height: 1350 },
    background: { mode: "solid", color: "#f5f1ea", blur: 24, mediaId: null },
    photo: { fitMode: "fit", zoom: 0.88, offsetX: 0, offsetY: -0.04 },
    layers: [
      createShapeLayer("star", {
        id: "badge",
        name: "Badge",
        x: 0.8,
        y: 0.14,
        width: 0.32,
        height: 0.26,
        rotation: 10,
        fill: "#ffcc00",
        stroke: "#1a1a1a",
        strokeWidth: 0.004,
        points: 12,
      }),
      createTextLayer({
        id: "badge-text",
        name: "Badge text",
        text: "50%\nOFF",
        x: 0.8,
        y: 0.14,
        width: 0.3,
        fontSize: 0.05,
        fontFamily: "display",
        rotation: 10,
        lineHeight: 1,
        color: "#1a1a1a",
        shadow: null,
      }),
      createTextLayer({
        id: "product",
        name: "Product name",
        text: "Product name",
        x: 0.5,
        y: 0.9,
        width: 0.8,
        fontSize: 0.05,
        color: "#1a1a1a",
        shadow: null,
      }),
      createTextLayer({
        id: "price",
        name: "Price",
        text: "$49 · limited time",
        x: 0.5,
        y: 0.955,
        width: 0.8,
        fontSize: 0.03,
        bold: false,
        color: "#7a6f60",
        shadow: null,
      }),
    ],
  }),
];

export function savedToTemplate(saved: SavedImageTemplate): ImageTemplate {
  return { ...saved, media: saved.media ?? {}, description: "", builtIn: false };
}

/**
 * Builds a saved template from the current document: the look plus a thumbnail. Image layers and
 * a background image keep pointing at the shared, content-addressed media store — nothing is
 * copied, and the blobs stay alive for as long as this template (or any project) refers to them.
 */
export function buildSavedTemplate(name: string, doc: ImageDocument, thumbnailDataUrl: string | null): SavedImageTemplate {
  return { id: crypto.randomUUID(), name, createdAt: Date.now(), thumbnailDataUrl, config: extractTemplateConfig(doc) };
}

/** Rewrites every media reference in a config through `mapping` (ids not in it are left alone). */
export function remapTemplateMedia(config: TemplateConfig, mapping: Map<string, string>): TemplateConfig {
  const layers: Layer[] = config.layers.map((layer) =>
    layer.kind === "image" ? { ...layer, mediaId: mapping.get(layer.mediaId) ?? layer.mediaId } : layer,
  );
  const backgroundMediaId = config.background.mediaId ? (mapping.get(config.background.mediaId) ?? config.background.mediaId) : null;
  return { ...config, layers, background: { ...config.background, mediaId: backgroundMediaId } };
}

/** Fresh layer ids for every application, so two applications of one template never share ids. */
export function freshLayerIds(config: TemplateConfig): TemplateConfig {
  return { ...config, layers: config.layers.map((layer) => ({ ...layer, id: crypto.randomUUID() })) };
}
