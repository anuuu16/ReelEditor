import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import { createInitialProject } from "./initialProject.js";
import { editorReducer, type Action, type EditorState } from "./reducer.js";

export type { Action, EditorState };

const EditorStateContext = createContext<EditorState | null>(null);
const EditorDispatchContext = createContext<Dispatch<Action> | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => ({
    project: createInitialProject(),
    playhead: 0,
    isPlaying: false,
  }));

  return (
    <EditorStateContext.Provider value={state}>
      <EditorDispatchContext.Provider value={dispatch}>{children}</EditorDispatchContext.Provider>
    </EditorStateContext.Provider>
  );
}

export function useEditorState(): EditorState {
  const ctx = useContext(EditorStateContext);
  if (!ctx) throw new Error("useEditorState must be used within EditorProvider");
  return ctx;
}

export function useEditorDispatch(): Dispatch<Action> {
  const ctx = useContext(EditorDispatchContext);
  if (!ctx) throw new Error("useEditorDispatch must be used within EditorProvider");
  return ctx;
}
