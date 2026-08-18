import type { AspectRatioPreset, Clip, MediaSource, ProjectModel } from "@reel-studio/shared-types";

export interface EditorState {
  project: ProjectModel;
  playhead: number;
  isPlaying: boolean;
}

export type Action =
  | { type: "ADD_SOURCE"; source: MediaSource }
  | { type: "ADD_CLIP"; trackId: string; sourceId: string; atIndex: number }
  | { type: "MOVE_CLIP"; clipId: string; trackId: string; atIndex: number }
  | { type: "REMOVE_CLIP"; clipId: string }
  | { type: "SET_PLAYHEAD"; time: number }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SET_ASPECT"; aspectRatio: AspectRatioPreset; width: number; height: number };

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

    case "ADD_CLIP": {
      const source = state.project.sources.find((s) => s.id === action.sourceId);
      if (!source) return state;
      const newClip: Clip = {
        id: crypto.randomUUID(),
        sourceId: source.id,
        trackId: action.trackId,
        inPoint: 0,
        outPoint: source.durationSeconds,
        timelineStart: 0,
        fitMode: "fit",
        transform: { scale: 1, x: 0, y: 0, rotation: 0 },
        volume: 1,
        speed: 1,
        opacity: 1,
        filter: { preset: null, brightness: 0, contrast: 0, saturation: 0 },
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
      return { ...state, project: { ...state.project, clips: state.project.clips.filter((c) => c.id !== action.clipId) } };

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

    default:
      return state;
  }
}
