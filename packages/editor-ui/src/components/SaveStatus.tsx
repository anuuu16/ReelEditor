import { useEffect, useState } from "react";
import { useEditorState } from "../state/EditorContext.js";
import { saveProject } from "../persistence/db.js";
import { saveProjectToServer } from "../persistence/projectServer.js";

type Status = "saved" | "saving" | "pending" | "error";

const LABELS: Record<Status, string> = {
  saved: "Saved",
  saving: "Saving…",
  pending: "Unsaved changes",
  error: "Save failed",
};

// Two autosave targets, on purpose: a near-instant local IndexedDB snapshot so a refresh never
// loses recent work, and the real save to ~/ReelStudioProjects (the same one "Save now" and the
// Projects panel use) so the on-disk project actually stays current without a manual click. The
// server save re-uploads every used media file with no dedup, so it's debounced far longer than
// the local one — continuous editing (dragging a slider, typing) only re-triggers it once the
// person actually pauses, not on every change.
const LOCAL_AUTOSAVE_DELAY_MS = 800;
const SERVER_AUTOSAVE_DELAY_MS = 5000;

export function SaveStatus() {
  const state = useEditorState();
  const [status, setStatus] = useState<Status>("saved");

  useEffect(() => {
    setStatus("pending");

    const localHandle = setTimeout(() => {
      saveProject(state.project).catch((err) => console.error("Local autosave failed", err));
    }, LOCAL_AUTOSAVE_DELAY_MS);

    const serverHandle = setTimeout(() => {
      setStatus("saving");
      saveProjectToServer(state.project)
        .then(() => setStatus("saved"))
        .catch((err) => {
          console.error("Autosave failed", err);
          setStatus("error");
        });
    }, SERVER_AUTOSAVE_DELAY_MS);

    return () => {
      clearTimeout(localHandle);
      clearTimeout(serverHandle);
    };
  }, [state.project]);

  async function handleSaveNow() {
    setStatus("saving");
    try {
      await saveProject(state.project);
      await saveProjectToServer(state.project);
      setStatus("saved");
    } catch (err) {
      console.error("Save failed", err);
      setStatus("error");
    }
  }

  return (
    <div className="save-status">
      <span className={`save-label save-label-${status}`}>{LABELS[status]}</span>
      <button type="button" onClick={handleSaveNow}>
        Save now
      </button>
    </div>
  );
}
