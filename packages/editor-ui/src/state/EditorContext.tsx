import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from "react";
import { createInitialProject, AUDIO_TRACK_ID } from "./initialProject.js";
import type { EditorState } from "./reducer.js";
import { createInitialHistoryState, historyReducer, type HistoryAction } from "./historyReducer.js";
import { loadMediaBlob, loadProject } from "../persistence/db.js";

export type { EditorState };
export type { HistoryAction as Action };

interface HistoryMeta {
  canUndo: boolean;
  canRedo: boolean;
}

const EditorStateContext = createContext<EditorState | null>(null);
const EditorDispatchContext = createContext<Dispatch<HistoryAction> | null>(null);
const EditorHistoryContext = createContext<HistoryMeta | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [history, dispatch] = useReducer(historyReducer, undefined, () =>
    createInitialHistoryState({
      project: createInitialProject(),
      playhead: 0,
      isPlaying: false,
      selectedClipId: null,
      selectedOverlayId: null,
      masterMuted: false,
      masterVolume: 1,
      activeAudioTrackId: AUDIO_TRACK_ID,
    })
  );

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

  const historyMeta: HistoryMeta = { canUndo: history.past.length > 0, canRedo: history.future.length > 0 };

  return (
    <EditorStateContext.Provider value={history.state}>
      <EditorDispatchContext.Provider value={dispatch}>
        <EditorHistoryContext.Provider value={historyMeta}>{children}</EditorHistoryContext.Provider>
      </EditorDispatchContext.Provider>
    </EditorStateContext.Provider>
  );
}

export function useEditorState(): EditorState {
  const ctx = useContext(EditorStateContext);
  if (!ctx) throw new Error("useEditorState must be used within EditorProvider");
  return ctx;
}

export function useEditorDispatch(): Dispatch<HistoryAction> {
  const ctx = useContext(EditorDispatchContext);
  if (!ctx) throw new Error("useEditorDispatch must be used within EditorProvider");
  return ctx;
}

export function useEditorHistory(): HistoryMeta {
  const ctx = useContext(EditorHistoryContext);
  if (!ctx) throw new Error("useEditorHistory must be used within EditorProvider");
  return ctx;
}
