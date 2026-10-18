import { describe, expect, it } from "vitest";
import type { Clip, MediaSource, ProjectModel } from "@reel-studio/shared-types";
import { getTimelineDuration } from "@reel-studio/timeline-core";
import { editorReducer, normalizeProject, type EditorState } from "./reducer.js";
import { AUDIO_TRACK_ID, createInitialProject, OVERLAY_TRACK_ID, VIDEO_TRACK_ID } from "./initialProject.js";

const video: MediaSource = {
  id: "land",
  name: "clip-landscape-4s.mp4",
  filePath: "",
  previewUrl: "blob:land",
  durationSeconds: 4,
  width: 1280,
  height: 720,
  kind: "video",
  isPlaceholder: false,
};
const music: MediaSource = { ...video, id: "music", name: "music-9s.m4a", durationSeconds: 9, width: 0, height: 0, kind: "audio" };

function stateWith(project: ProjectModel, overrides: Partial<EditorState> = {}): EditorState {
  return {
    project,
    playhead: 0,
    isPlaying: false,
    selectedClipId: null,
    selectedOverlayId: null,
    masterMuted: false,
    masterVolume: 1,
    activeAudioTrackId: AUDIO_TRACK_ID,
    ...overrides,
  };
}

// The user's project: a 4 s clip, 9 s of music, a 12 s title.
function userProject(): ProjectModel {
  let state = stateWith({ ...createInitialProject(), sources: [video, music] });
  state = editorReducer(state, { type: "ADD_CLIP", trackId: VIDEO_TRACK_ID, sourceId: "land", atIndex: 0 });
  state = editorReducer(state, { type: "ADD_CLIP", trackId: AUDIO_TRACK_ID, sourceId: "music", atIndex: 0 });
  state = editorReducer(state, { type: "ADD_TEXT_OVERLAY", trackId: OVERLAY_TRACK_ID, start: 0, end: 12 });
  return state.project;
}

// What a project file looked like before endBehavior (and, further back, before transitions/gaps) existed.
function savedBeforeTheUpdate(): ProjectModel {
  const { endBehavior: _dropped, ...project } = userProject();
  const clips = project.clips.map((c) => {
    const { transitionOutSeconds: _t, transitionOutType: _tt, gapBeforeSeconds: _g, opacity: _o, ...rest } = c;
    return rest as Clip;
  });
  return { ...project, clips } as ProjectModel;
}

describe("normalizeProject — opening a project saved before this version", () => {
  it("defaults endBehavior to 'black', the only behaviour those projects ever had", () => {
    const old = savedBeforeTheUpdate();
    expect("endBehavior" in old).toBe(false);
    expect(normalizeProject(old).endBehavior).toBe("black");
  });

  it("fills in the clip fields older saves don't have, so layout and export see numbers", () => {
    const normalized = normalizeProject(savedBeforeTheUpdate());
    for (const clip of normalized.clips) {
      expect(clip.transitionOutSeconds).toBe(0);
      expect(clip.transitionOutType).toBe("dissolve");
      expect(clip.gapBeforeSeconds).toBe(0);
    }
  });

  it("keeps a current project's own choice", () => {
    expect(normalizeProject({ ...userProject(), endBehavior: "freeze" }).endBehavior).toBe("freeze");
  });

  it("leaves the reel the same length as before the update: 12 s (the title) for the user's project", () => {
    expect(getTimelineDuration(normalizeProject(savedBeforeTheUpdate()))).toBe(12);
  });
});

describe("LOAD_PROJECT", () => {
  it("normalizes what it loads and resets playback", () => {
    const state = editorReducer(stateWith(createInitialProject(), { playhead: 5, isPlaying: true }), {
      type: "LOAD_PROJECT",
      project: savedBeforeTheUpdate(),
    });
    expect(state.project.endBehavior).toBe("black");
    expect(state.playhead).toBe(0);
    expect(state.isPlaying).toBe(false);
    expect(state.activeAudioTrackId).toBe(AUDIO_TRACK_ID);
  });
});

describe("SET_END_BEHAVIOR", () => {
  it("'black' and 'freeze' keep the 12 s reel; 'trim' cuts it to the 4 s of video", () => {
    const base = stateWith(userProject());
    expect(getTimelineDuration(editorReducer(base, { type: "SET_END_BEHAVIOR", endBehavior: "black" }).project)).toBe(12);
    expect(getTimelineDuration(editorReducer(base, { type: "SET_END_BEHAVIOR", endBehavior: "freeze" }).project)).toBe(12);
    expect(getTimelineDuration(editorReducer(base, { type: "SET_END_BEHAVIOR", endBehavior: "trim" }).project)).toBe(4);
  });

  it("pulls the playhead back (and stops playback) when 'trim' shortens the reel past it", () => {
    const playing = stateWith(userProject(), { playhead: 9, isPlaying: true });
    const trimmed = editorReducer(playing, { type: "SET_END_BEHAVIOR", endBehavior: "trim" });
    expect(trimmed.playhead).toBe(4);
    expect(trimmed.isPlaying).toBe(false);
  });

  it("leaves the playhead alone when it's still inside the reel", () => {
    const playing = stateWith(userProject(), { playhead: 2, isPlaying: true });
    const trimmed = editorReducer(playing, { type: "SET_END_BEHAVIOR", endBehavior: "trim" });
    expect(trimmed.playhead).toBe(2);
    expect(trimmed.isPlaying).toBe(true);
  });

  it("switching back restores the full length", () => {
    const trimmed = editorReducer(stateWith(userProject()), { type: "SET_END_BEHAVIOR", endBehavior: "trim" });
    expect(getTimelineDuration(editorReducer(trimmed, { type: "SET_END_BEHAVIOR", endBehavior: "black" }).project)).toBe(12);
  });
});

describe("a new project", () => {
  it("starts with 'black', matching every project made before the setting existed", () => {
    expect(createInitialProject().endBehavior).toBe("black");
  });
});
