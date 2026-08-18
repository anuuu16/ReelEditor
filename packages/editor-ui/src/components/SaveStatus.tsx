import { useEffect, useState } from "react";
import { useEditorState } from "../state/EditorContext.js";
import { saveProject } from "../persistence/db.js";

type Status = "saved" | "saving" | "pending" | "error";

const LABELS: Record<Status, string> = {
  saved: "Saved",
  saving: "Saving…",
  pending: "Unsaved changes",
  error: "Save failed",
};

const AUTOSAVE_DELAY_MS = 800;

export function SaveStatus() {
  const state = useEditorState();
  const [status, setStatus] = useState<Status>("saved");

  useEffect(() => {
    setStatus("pending");
    const handle = setTimeout(() => {
      setStatus("saving");
      saveProject(state.project)
        .then(() => setStatus("saved"))
        .catch((err) => {
          console.error("Autosave failed", err);
          setStatus("error");
        });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(handle);
  }, [state.project]);

  async function handleSaveNow() {
    setStatus("saving");
    try {
      await saveProject(state.project);
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
