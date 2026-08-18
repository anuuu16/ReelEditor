import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from "react";
import { createInitialProject } from "./initialProject.js";
import { editorReducer, type Action, type EditorState } from "./reducer.js";
import { loadMediaBlob, loadProject } from "../persistence/db.js";

export type { Action, EditorState };

const EditorStateContext = createContext<EditorState | null>(null);
const EditorDispatchContext = createContext<Dispatch<Action> | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => ({
    project: createInitialProject(),
    playhead: 0,
    isPlaying: false,
    selectedClipId: null,
    masterMuted: false,
  }));

  useEffect(() => {
    (async () => {
      const saved = await loadProject();
      if (!saved) return;
      const hydratedSources = await Promise.all(
        saved.sources.map(async (source) => {
          const blob = await loadMediaBlob(source.id);
          if (!blob) {
            console.warn(`Missing stored media for "${source.name}" — re-import it to restore this clip.`);
            return { ...source, previewUrl: "" };
          }
          return { ...source, previewUrl: URL.createObjectURL(blob) };
        })
      );
      dispatch({ type: "LOAD_PROJECT", project: { ...saved, sources: hydratedSources } });
    })().catch((err) => console.error("Failed to load saved project", err));
  }, []);

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
