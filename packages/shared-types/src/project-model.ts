export type AspectRatioPreset = "9:16" | "1:1" | "16:9" | "4:5" | "4:3" | "custom";

export interface Canvas {
  aspectRatio: AspectRatioPreset;
  width: number;
  height: number;
  frameRate: number;
}

export type FitMode = "fit" | "fill" | "stretch";

export interface Transform {
  scale: number;
  x: number;
  y: number;
  rotation: number;
}

export interface ClipFilter {
  preset: string | null;
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
}

export interface Clip {
  id: string;
  sourceId: string;
  trackId: string;
  label: string;
  inPoint: number;
  outPoint: number;
  timelineStart: number;
  fitMode: FitMode;
  transform: Transform;
  volume: number;
  muted: boolean;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  speed: number;
  opacity: number;
  filter: ClipFilter;
  /** Transition into the next clip on this track, in seconds. 0 = a hard cut. Ignored on the last clip. */
  transitionOutSeconds: number;
  transitionOutType: TransitionType;
}

export type TransitionType = "dissolve" | "slide" | "wipe" | "zoom";

export type OverlayAnimation = "none" | "fade" | "slide-in" | "pop" | "typewriter";
export type OverlayKind = "text" | "image";

export interface Overlay {
  id: string;
  trackId: string;
  kind: OverlayKind;
  content: string;
  imageSourceId: string | null;
  widthRatio: number;
  heightRatio: number;
  start: number;
  end: number;
  position: { x: number; y: number };
  style: {
    font: string;
    size: number;
    color: string;
    align: "left" | "center" | "right";
    background: string | null;
    outline: string | null;
  };
  animation: OverlayAnimation;
}

export type TrackKind = "video" | "overlay" | "audio";

export interface Track {
  id: string;
  kind: TrackKind;
  order: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export interface MediaSource {
  id: string;
  name: string;
  filePath: string;
  previewUrl: string;
  durationSeconds: number;
  width: number;
  height: number;
  kind: "video" | "audio" | "image";
  /** A template's placeholder slot — has no real file, waiting for the person to assign their own footage. */
  isPlaceholder: boolean;
}

export interface ProjectMetadata {
  name: string;
  /** The template this project was started from, if any (lineage only — not "this project is a template"). */
  templateId: string | null;
  /** True when this saved project IS a reusable template (placeholder sources, no real media). */
  isTemplate: boolean;
  createdAt: number;
  updatedAt: number;
  thumbnailDataUrl: string | null;
}

export interface ProjectModel {
  id: string;
  canvas: Canvas;
  tracks: Track[];
  clips: Clip[];
  overlays: Overlay[];
  sources: MediaSource[];
  metadata: ProjectMetadata;
}
