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
}

export interface Clip {
  id: string;
  sourceId: string;
  trackId: string;
  inPoint: number;
  outPoint: number;
  timelineStart: number;
  fitMode: FitMode;
  transform: Transform;
  volume: number;
  speed: number;
  opacity: number;
  filter: ClipFilter;
}

export type OverlayAnimation = "none" | "fade" | "slide-in" | "pop" | "typewriter";

export interface Overlay {
  id: string;
  trackId: string;
  content: string;
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
}

export interface ProjectMetadata {
  name: string;
  templateId: string | null;
  createdAt: number;
  updatedAt: number;
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
