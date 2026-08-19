import type { AspectRatioPreset, Clip, MediaSource, Overlay, ProjectModel } from "@reel-studio/shared-types";
import { layoutSequentialClips } from "@reel-studio/timeline-core";

export const MIN_CLIP_DURATION_SECONDS = 0.1;
export const MIN_OVERLAY_DURATION_SECONDS = 0.2;

export interface EditorState {
  project: ProjectModel;
  playhead: number;
  isPlaying: boolean;
  selectedClipId: string | null;
  selectedOverlayId: string | null;
  masterMuted: boolean;
}

export type Action =
  | { type: "ADD_SOURCE"; source: MediaSource }
  | { type: "REMOVE_SOURCE"; sourceId: string }
  | { type: "ADD_CLIP"; trackId: string; sourceId: string; atIndex: number }
  | { type: "MOVE_CLIP"; clipId: string; trackId: string; atIndex: number }
  | { type: "REMOVE_CLIP"; clipId: string }
  | { type: "UPDATE_CLIP"; clipId: string; patch: Partial<Clip> }
  | { type: "SPLIT_CLIP"; clipId: string; atTime: number }
  | { type: "BULK_MUTE"; trackId: string; muted: boolean }
  | { type: "BULK_SET_VOLUME"; trackId: string; volume: number }
  | { type: "BULK_SET_FADE"; trackId: string; fadeInSeconds: number; fadeOutSeconds: number }
  | { type: "SELECT_CLIP"; clipId: string | null }
  | { type: "ADD_TEXT_OVERLAY"; trackId: string; start: number; end: number }
  | { type: "ADD_IMAGE_OVERLAY"; trackId: string; sourceId: string; start: number; end: number }
  | { type: "UPDATE_OVERLAY"; overlayId: string; patch: Partial<Overlay> }
  | { type: "REMOVE_OVERLAY"; overlayId: string }
  | { type: "SELECT_OVERLAY"; overlayId: string | null }
  | { type: "SET_PLAYHEAD"; time: number }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SET_ASPECT"; aspectRatio: AspectRatioPreset; width: number; height: number }
  | { type: "SET_PROJECT_NAME"; name: string }
  | { type: "TOGGLE_MASTER_MUTE" }
  | { type: "LOAD_PROJECT"; project: ProjectModel };

function insertClipAt(clips: Clip[], trackId: string, atIndex: number, newClip: Clip): Clip[] {
  const trackClips = clips.filter((c) => c.trackId === trackId);
  const others = clips.filter((c) => c.trackId !== trackId);
  const index = Math.max(0, Math.min(atIndex, trackClips.length));
  trackClips.splice(index, 0, newClip);
  return [...others, ...trackClips];
}

function moveClipTo(clips: Clip[], clipId: string, trackId: string, atIndex: number): Clip[] {
  const moving = clips.find((c) => c.id === clipId);
  if (!moving) return clips;
  const rest = clips.filter((c) => c.id !== clipId);
  const trackClips = rest.filter((c) => c.trackId === trackId);
  const others = rest.filter((c) => c.trackId !== trackId);
  const index = Math.max(0, Math.min(atIndex, trackClips.length));
  trackClips.splice(index, 0, { ...moving, trackId });
  return [...others, ...trackClips];
}

export function editorReducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "ADD_SOURCE":
      return { ...state, project: { ...state.project, sources: [...state.project.sources, action.source] } };

    case "REMOVE_SOURCE": {
      const remainingClips = state.project.clips.filter((c) => c.sourceId !== action.sourceId);
      const remainingOverlays = state.project.overlays.filter((o) => o.imageSourceId !== action.sourceId);
      const selectedClipStillExists = remainingClips.some((c) => c.id === state.selectedClipId);
      const selectedOverlayStillExists = remainingOverlays.some((o) => o.id === state.selectedOverlayId);
      return {
        ...state,
        project: {
          ...state.project,
          sources: state.project.sources.filter((s) => s.id !== action.sourceId),
          clips: remainingClips,
          overlays: remainingOverlays,
        },
        selectedClipId: selectedClipStillExists ? state.selectedClipId : null,
        selectedOverlayId: selectedOverlayStillExists ? state.selectedOverlayId : null,
      };
    }

    case "ADD_CLIP": {
      const source = state.project.sources.find((s) => s.id === action.sourceId);
      if (!source) return state;
      const newClip: Clip = {
        id: crypto.randomUUID(),
        sourceId: source.id,
        trackId: action.trackId,
        label: "",
        inPoint: 0,
        outPoint: source.durationSeconds,
        timelineStart: 0,
        fitMode: "fit",
        transform: { scale: 1, x: 0, y: 0, rotation: 0 },
        volume: 1,
        muted: false,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        speed: 1,
        opacity: 1,
        filter: { preset: null, brightness: 0, contrast: 1, saturation: 1, hue: 0 },
      };
      return {
        ...state,
        project: { ...state.project, clips: insertClipAt(state.project.clips, action.trackId, action.atIndex, newClip) },
      };
    }

    case "MOVE_CLIP":
      return {
        ...state,
        project: { ...state.project, clips: moveClipTo(state.project.clips, action.clipId, action.trackId, action.atIndex) },
      };

    case "REMOVE_CLIP":
      return {
        ...state,
        project: { ...state.project, clips: state.project.clips.filter((c) => c.id !== action.clipId) },
        selectedClipId: state.selectedClipId === action.clipId ? null : state.selectedClipId,
      };

    case "UPDATE_CLIP":
      return {
        ...state,
        project: {
          ...state.project,
          clips: state.project.clips.map((c) => (c.id === action.clipId ? { ...c, ...action.patch } : c)),
        },
      };

    case "BULK_MUTE":
      return {
        ...state,
        project: {
          ...state.project,
          clips: state.project.clips.map((c) => (c.trackId === action.trackId ? { ...c, muted: action.muted } : c)),
        },
      };

    case "BULK_SET_VOLUME":
      return {
        ...state,
        project: {
          ...state.project,
          clips: state.project.clips.map((c) => (c.trackId === action.trackId ? { ...c, volume: action.volume } : c)),
        },
      };

    case "BULK_SET_FADE":
      return {
        ...state,
        project: {
          ...state.project,
          clips: state.project.clips.map((c) => {
            if (c.trackId !== action.trackId) return c;
            const duration = (c.outPoint - c.inPoint) / c.speed;
            const maxFade = duration / 2;
            return {
              ...c,
              fadeInSeconds: Math.min(Math.max(action.fadeInSeconds, 0), maxFade),
              fadeOutSeconds: Math.min(Math.max(action.fadeOutSeconds, 0), maxFade),
            };
          }),
        },
      };

    case "SPLIT_CLIP": {
      const clip = state.project.clips.find((c) => c.id === action.clipId);
      if (!clip) return state;
      const trackClips = layoutSequentialClips(state.project.clips.filter((c) => c.trackId === clip.trackId));
      const laidOut = trackClips.find((c) => c.id === clip.id);
      if (!laidOut) return state;

      const splitSourceTime = clip.inPoint + (action.atTime - laidOut.timelineStart) * clip.speed;
      if (
        splitSourceTime <= clip.inPoint + MIN_CLIP_DURATION_SECONDS ||
        splitSourceTime >= clip.outPoint - MIN_CLIP_DURATION_SECONDS
      ) {
        return state;
      }

      const firstHalf: Clip = { ...clip, outPoint: splitSourceTime };
      const secondHalf: Clip = { ...clip, id: crypto.randomUUID(), inPoint: splitSourceTime };
      const index = state.project.clips.findIndex((c) => c.id === action.clipId);
      const clips = [...state.project.clips];
      clips.splice(index, 1, firstHalf, secondHalf);

      return { ...state, project: { ...state.project, clips }, selectedClipId: firstHalf.id };
    }

    case "SELECT_CLIP":
      return { ...state, selectedClipId: action.clipId, selectedOverlayId: action.clipId ? null : state.selectedOverlayId };

    case "ADD_TEXT_OVERLAY": {
      const newOverlay: Overlay = {
        id: crypto.randomUUID(),
        trackId: action.trackId,
        kind: "text",
        content: "New title",
        imageSourceId: null,
        widthRatio: 1,
        heightRatio: 1,
        start: action.start,
        end: action.end,
        position: { x: 0.5, y: 0.85 },
        style: { font: "system-ui, sans-serif", size: 48, color: "#ffffff", align: "center", background: null, outline: "#000000" },
        animation: "none",
      };
      return {
        ...state,
        project: { ...state.project, overlays: [...state.project.overlays, newOverlay] },
        selectedOverlayId: newOverlay.id,
        selectedClipId: null,
      };
    }

    case "ADD_IMAGE_OVERLAY": {
      const source = state.project.sources.find((s) => s.id === action.sourceId);
      const widthRatio = 0.22;
      const imageAspect = source && source.width > 0 ? source.height / source.width : 1;
      const canvasAspect = state.project.canvas.width / state.project.canvas.height;
      const heightRatio = Math.min(1, widthRatio * imageAspect * canvasAspect);

      const newOverlay: Overlay = {
        id: crypto.randomUUID(),
        trackId: action.trackId,
        kind: "image",
        content: "",
        imageSourceId: action.sourceId,
        widthRatio,
        heightRatio,
        start: action.start,
        end: action.end,
        position: { x: 0.85, y: 0.88 },
        style: { font: "system-ui, sans-serif", size: 48, color: "#ffffff", align: "center", background: null, outline: null },
        animation: "none",
      };
      return {
        ...state,
        project: { ...state.project, overlays: [...state.project.overlays, newOverlay] },
        selectedOverlayId: newOverlay.id,
        selectedClipId: null,
      };
    }

    case "UPDATE_OVERLAY":
      return {
        ...state,
        project: {
          ...state.project,
          overlays: state.project.overlays.map((o) => (o.id === action.overlayId ? { ...o, ...action.patch } : o)),
        },
      };

    case "REMOVE_OVERLAY":
      return {
        ...state,
        project: { ...state.project, overlays: state.project.overlays.filter((o) => o.id !== action.overlayId) },
        selectedOverlayId: state.selectedOverlayId === action.overlayId ? null : state.selectedOverlayId,
      };

    case "SELECT_OVERLAY":
      return { ...state, selectedOverlayId: action.overlayId, selectedClipId: action.overlayId ? null : state.selectedClipId };

    case "SET_PLAYHEAD":
      return { ...state, playhead: Math.max(0, action.time) };

    case "PLAY":
      return { ...state, isPlaying: true };

    case "PAUSE":
      return { ...state, isPlaying: false };

    case "SET_ASPECT":
      return {
        ...state,
        project: {
          ...state.project,
          canvas: { ...state.project.canvas, aspectRatio: action.aspectRatio, width: action.width, height: action.height },
        },
      };

    case "SET_PROJECT_NAME":
      return { ...state, project: { ...state.project, metadata: { ...state.project.metadata, name: action.name } } };

    case "TOGGLE_MASTER_MUTE":
      return { ...state, masterMuted: !state.masterMuted };

    case "LOAD_PROJECT":
      return {
        project: action.project,
        playhead: 0,
        isPlaying: false,
        selectedClipId: null,
        selectedOverlayId: null,
        masterMuted: false,
      };

    default:
      return state;
  }
}
