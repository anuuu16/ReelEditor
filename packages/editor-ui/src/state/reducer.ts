import type {
  AspectRatioPreset,
  Clip,
  ClipFilter,
  FitMode,
  MediaSource,
  Overlay,
  ProjectModel,
  Track,
  Transform,
  TransitionType,
} from "@reel-studio/shared-types";
import { getTracksByKind, layoutSequentialClips } from "@reel-studio/timeline-core";
import { DEFAULT_IMAGE_CLIP_DURATION_SECONDS } from "../media/trackAccepts.js";

export const MIN_CLIP_DURATION_SECONDS = 0.1;
export const MIN_OVERLAY_DURATION_SECONDS = 0.2;

export interface EditorState {
  project: ProjectModel;
  playhead: number;
  isPlaying: boolean;
  selectedClipId: string | null;
  selectedOverlayId: string | null;
  masterMuted: boolean;
  masterVolume: number;
  /** The audio track new clips (dropped from the media library) land on, and the default bulk-edit target. */
  activeAudioTrackId: string | null;
}

export type Action =
  | { type: "ADD_SOURCE"; source: MediaSource }
  | { type: "REMOVE_SOURCE"; sourceId: string }
  | { type: "ADD_CLIP"; trackId: string; sourceId: string; atIndex: number }
  | { type: "MOVE_CLIP"; clipId: string; trackId: string; atIndex: number }
  | { type: "REMOVE_CLIP"; clipId: string }
  | { type: "UPDATE_CLIP"; clipId: string; patch: Partial<Clip> }
  | { type: "SPLIT_CLIP"; clipId: string; atTime: number }
  | { type: "MERGE_CLIP"; clipId: string }
  | { type: "DUPLICATE_CLIP"; clipId: string }
  | { type: "REPLACE_CLIP_SOURCE"; clipId: string; sourceId: string }
  | { type: "BULK_MUTE"; trackId: string; muted: boolean }
  | { type: "BULK_SET_VOLUME"; trackId: string; volume: number }
  | { type: "BULK_SET_FADE"; trackId: string; fadeInSeconds: number; fadeOutSeconds: number }
  | { type: "BULK_SET_FIT_MODE"; trackId: string; fitMode: FitMode }
  | { type: "BULK_SET_FILTER"; trackId: string; patch: Partial<ClipFilter> }
  | { type: "BULK_SET_TRANSFORM"; trackId: string; patch: Partial<Transform> }
  | {
      type: "BULK_SET_TRANSITION";
      trackId: string;
      transitionOutSeconds: number;
      transitionOutType: TransitionType;
      compensateLength?: boolean;
    }
  | { type: "SELECT_CLIP"; clipId: string | null }
  | { type: "ADD_TRACK"; kind: "audio" }
  | { type: "REMOVE_TRACK"; trackId: string }
  | { type: "SELECT_TRACK"; trackId: string }
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
  | { type: "SET_MASTER_VOLUME"; volume: number }
  | { type: "LOAD_PROJECT"; project: ProjectModel };

function insertClipAt(clips: Clip[], trackId: string, atIndex: number, newClip: Clip): Clip[] {
  const trackClips = clips.filter((c) => c.trackId === trackId);
  const others = clips.filter((c) => c.trackId !== trackId);
  const index = Math.max(0, Math.min(atIndex, trackClips.length));
  trackClips.splice(index, 0, newClip);
  return [...others, ...trackClips];
}

// Projects saved before a given clip field existed won't have it in storage at all. Loading one
// straight into state would leave that field `undefined` at runtime despite the type saying
// otherwise — fill in safe defaults so older projects behave exactly like new ones.
function normalizeProject(project: ProjectModel): ProjectModel {
  return {
    ...project,
    clips: project.clips.map((c) => ({
      ...c,
      transitionOutSeconds: c.transitionOutSeconds ?? 0,
      transitionOutType: c.transitionOutType ?? "dissolve",
    })),
    sources: project.sources.map((s) => ({ ...s, isPlaceholder: s.isPlaceholder ?? false })),
    metadata: { ...project.metadata, isTemplate: project.metadata.isTemplate ?? false },
  };
}

export function findMergeableNeighbor(clips: Clip[], clip: Clip): Clip | null {
  const trackClips = clips.filter((c) => c.trackId === clip.trackId);
  const index = trackClips.findIndex((c) => c.id === clip.id);
  if (index === -1) return null;
  const next = trackClips[index + 1];
  if (!next || next.sourceId !== clip.sourceId || next.inPoint !== clip.outPoint) return null;
  return next;
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
      const isImage = source.kind === "image";
      const newClip: Clip = {
        id: crypto.randomUUID(),
        sourceId: source.id,
        trackId: action.trackId,
        label: "",
        inPoint: 0,
        // A video/audio clip defaults to its full source length. An image has no intrinsic length
        // (source.durationSeconds is just the trim ceiling), so it defaults to a short still instead.
        outPoint: isImage ? Math.min(DEFAULT_IMAGE_CLIP_DURATION_SECONDS, source.durationSeconds) : source.durationSeconds,
        timelineStart: 0,
        fitMode: "fit",
        transform: { scale: 1, x: 0, y: 0, rotation: 0 },
        volume: 1,
        muted: isImage,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        speed: 1,
        opacity: 1,
        filter: { preset: null, brightness: 0, contrast: 1, saturation: 1, hue: 0 },
        transitionOutSeconds: 0,
        transitionOutType: "dissolve",
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

    case "BULK_SET_FIT_MODE":
      return {
        ...state,
        project: {
          ...state.project,
          clips: state.project.clips.map((c) => (c.trackId === action.trackId ? { ...c, fitMode: action.fitMode } : c)),
        },
      };

    case "BULK_SET_FILTER":
      return {
        ...state,
        project: {
          ...state.project,
          clips: state.project.clips.map((c) =>
            c.trackId === action.trackId ? { ...c, filter: { ...c.filter, ...action.patch } } : c
          ),
        },
      };

    case "BULK_SET_TRANSFORM":
      return {
        ...state,
        project: {
          ...state.project,
          clips: state.project.clips.map((c) =>
            c.trackId === action.trackId ? { ...c, transform: { ...c.transform, ...action.patch } } : c
          ),
        },
      };

    case "BULK_SET_TRANSITION": {
      // The last clip on the track has no "next" clip to transition into, so
      // layoutSequentialClips ignores its transitionOutSeconds — extending its
      // outPoint here would just add trailing footage with nothing to offset it.
      const trackClips = state.project.clips.filter((c) => c.trackId === action.trackId);
      const lastId = trackClips.length > 0 ? trackClips[trackClips.length - 1].id : null;

      return {
        ...state,
        project: {
          ...state.project,
          clips: state.project.clips.map((c) => {
            if (c.trackId !== action.trackId) return c;
            if (!action.compensateLength || c.id === lastId) {
              return { ...c, transitionOutSeconds: action.transitionOutSeconds, transitionOutType: action.transitionOutType };
            }
            // Ripple-extend into unused source footage by exactly the overlap amount, so the
            // clip's contribution to the sequential layout (duration - overlap) is unchanged and
            // the overall timeline length stays put even as the transition duration changes.
            const source = state.project.sources.find((s) => s.id === c.sourceId);
            const maxOut = source?.durationSeconds ?? c.outPoint;
            const deltaSeconds = (action.transitionOutSeconds - c.transitionOutSeconds) * c.speed;
            const minOut = c.inPoint + MIN_CLIP_DURATION_SECONDS * c.speed;
            const outPoint = Math.max(minOut, Math.min(maxOut, c.outPoint + deltaSeconds));
            return { ...c, outPoint, transitionOutSeconds: action.transitionOutSeconds, transitionOutType: action.transitionOutType };
          }),
        },
      };
    }

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

      // A split is a hard cut: the transition that used to carry from `clip` into whatever followed
      // it now belongs to the second half, which is the one that actually still has that neighbor.
      const firstHalf: Clip = { ...clip, outPoint: splitSourceTime, transitionOutSeconds: 0 };
      const secondHalf: Clip = { ...clip, id: crypto.randomUUID(), inPoint: splitSourceTime };
      const index = state.project.clips.findIndex((c) => c.id === action.clipId);
      const clips = [...state.project.clips];
      clips.splice(index, 1, firstHalf, secondHalf);

      return { ...state, project: { ...state.project, clips }, selectedClipId: firstHalf.id };
    }

    case "MERGE_CLIP": {
      const clip = state.project.clips.find((c) => c.id === action.clipId);
      if (!clip) return state;
      const next = findMergeableNeighbor(state.project.clips, clip);
      if (!next) return state;

      // The merged clip now transitions into whatever `next` used to transition into, not into `next` itself.
      const merged: Clip = {
        ...clip,
        outPoint: next.outPoint,
        transitionOutSeconds: next.transitionOutSeconds,
        transitionOutType: next.transitionOutType,
      };
      const clips = state.project.clips.filter((c) => c.id !== next.id).map((c) => (c.id === clip.id ? merged : c));

      return { ...state, project: { ...state.project, clips }, selectedClipId: merged.id };
    }

    case "DUPLICATE_CLIP": {
      const index = state.project.clips.findIndex((c) => c.id === action.clipId);
      if (index === -1) return state;
      const duplicate: Clip = { ...state.project.clips[index], id: crypto.randomUUID() };
      const clips = [...state.project.clips];
      clips.splice(index + 1, 0, duplicate);
      return { ...state, project: { ...state.project, clips }, selectedClipId: duplicate.id };
    }

    case "REPLACE_CLIP_SOURCE": {
      const clip = state.project.clips.find((c) => c.id === action.clipId);
      const oldSource = clip && state.project.sources.find((s) => s.id === clip.sourceId);
      const newSource = state.project.sources.find((s) => s.id === action.sourceId);
      if (!clip || !newSource || (oldSource && oldSource.kind !== newSource.kind)) return state;

      const currentDuration = (clip.outPoint - clip.inPoint) / clip.speed;
      const outPoint = Math.min(currentDuration * clip.speed, newSource.durationSeconds);

      return {
        ...state,
        project: {
          ...state.project,
          clips: state.project.clips.map((c) =>
            c.id === action.clipId ? { ...c, sourceId: action.sourceId, inPoint: 0, outPoint } : c
          ),
        },
      };
    }

    case "SELECT_CLIP":
      return { ...state, selectedClipId: action.clipId, selectedOverlayId: action.clipId ? null : state.selectedOverlayId };

    case "ADD_TRACK": {
      const maxOrder = state.project.tracks.reduce((max, t) => Math.max(max, t.order), -1);
      const newTrack: Track = { id: crypto.randomUUID(), kind: action.kind, order: maxOrder + 1, volume: 1, fadeIn: 0, fadeOut: 0 };
      return {
        ...state,
        project: { ...state.project, tracks: [...state.project.tracks, newTrack] },
        activeAudioTrackId: action.kind === "audio" ? newTrack.id : state.activeAudioTrackId,
      };
    }

    case "REMOVE_TRACK": {
      const track = state.project.tracks.find((t) => t.id === action.trackId);
      if (!track) return state;
      // Every clip kind needs somewhere to live — refuse to remove the last track of its kind.
      if (getTracksByKind(state.project, track.kind).length <= 1) return state;

      const remainingTracks = state.project.tracks.filter((t) => t.id !== action.trackId);
      const remainingClips = state.project.clips.filter((c) => c.trackId !== action.trackId);
      const wasActive = state.activeAudioTrackId === action.trackId;
      const selectedClipRemoved = state.selectedClipId != null && !remainingClips.some((c) => c.id === state.selectedClipId);
      return {
        ...state,
        project: { ...state.project, tracks: remainingTracks, clips: remainingClips },
        selectedClipId: selectedClipRemoved ? null : state.selectedClipId,
        activeAudioTrackId: wasActive ? getTracksByKind({ ...state.project, tracks: remainingTracks }, "audio")[0]?.id ?? null : state.activeAudioTrackId,
      };
    }

    case "SELECT_TRACK":
      return { ...state, activeAudioTrackId: action.trackId };

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

    case "SET_MASTER_VOLUME":
      return { ...state, masterVolume: Math.max(0, Math.min(1, action.volume)) };

    case "LOAD_PROJECT": {
      const project = normalizeProject(action.project);
      return {
        project,
        playhead: 0,
        isPlaying: false,
        selectedClipId: null,
        selectedOverlayId: null,
        masterMuted: false,
        masterVolume: 1,
        activeAudioTrackId: getTracksByKind(project, "audio")[0]?.id ?? null,
      };
    }

    default:
      return state;
  }
}
