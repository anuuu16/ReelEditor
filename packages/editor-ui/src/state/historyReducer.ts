import type { ProjectModel } from "@reel-studio/shared-types";
import { editorReducer, type Action, type EditorState } from "./reducer.js";

export type HistoryAction = Action | { type: "UNDO" } | { type: "REDO" };

export interface HistoryState {
  state: EditorState;
  past: ProjectModel[];
  future: ProjectModel[];
}

const MAX_HISTORY = 100;

export function createInitialHistoryState(initial: EditorState): HistoryState {
  return { state: initial, past: [], future: [] };
}

export function historyReducer(history: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === "UNDO") {
    if (history.past.length === 0) return history;
    const previousProject = history.past[history.past.length - 1];
    const past = history.past.slice(0, -1);
    const future = [history.state.project, ...history.future];
    return { state: { ...history.state, project: previousProject, selectedClipId: null, selectedOverlayId: null }, past, future };
  }

  if (action.type === "REDO") {
    if (history.future.length === 0) return history;
    const nextProject = history.future[0];
    const future = history.future.slice(1);
    const past = [...history.past, history.state.project];
    return { state: { ...history.state, project: nextProject, selectedClipId: null, selectedOverlayId: null }, past, future };
  }

  const nextState = editorReducer(history.state, action);

  if (action.type === "LOAD_PROJECT") {
    return { state: nextState, past: [], future: [] };
  }

  if (nextState.project === history.state.project) {
    return { ...history, state: nextState };
  }

  const past = [...history.past, history.state.project].slice(-MAX_HISTORY);
  return { state: nextState, past, future: [] };
}
