import { useEffect, useRef, useState } from "react";
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

  // Refs so the unload/visibility-change/unmount flush below (registered once, deps: []) always sees
  // the latest project and status without re-registering its listeners on every single edit.
  const stateRef = useRef(state);
  stateRef.current = state;
  const statusRef = useRef(status);
  statusRef.current = status;
  // Timestamp of the oldest not-yet-server-saved edit, so a steady stream of edits (each one resets
  // a plain debounce timer) can't push the server save off indefinitely — see maxWait below.
  const pendingSinceRef = useRef<number | null>(null);

  useEffect(() => {
    setStatus("pending");
    if (pendingSinceRef.current === null) pendingSinceRef.current = Date.now();

    const localHandle = setTimeout(() => {
      saveProject(state.project).catch((err) => console.error("Local autosave failed", err));
    }, LOCAL_AUTOSAVE_DELAY_MS);

    // maxWait: schedule against how long a change has been waiting, not just since the last edit —
    // otherwise continuous editing (adding clips one after another) keeps resetting a plain debounce
    // and the server (the actual ~/ReelStudioProjects file) never gets a chance to save.
    const elapsedSincePending = Date.now() - pendingSinceRef.current;
    const serverDelay = Math.max(0, SERVER_AUTOSAVE_DELAY_MS - elapsedSincePending);

    const serverHandle = setTimeout(() => {
      setStatus("saving");
      saveProjectToServer(state.project)
        .then(() => {
          pendingSinceRef.current = null;
          setStatus("saved");
        })
        .catch((err) => {
          console.error("Autosave failed", err);
          setStatus("error");
        });
    }, serverDelay);

    return () => {
      clearTimeout(localHandle);
      clearTimeout(serverHandle);
    };
  }, [state.project]);

  // Best-effort flush for the moments a debounce timer would otherwise just get cancelled outright:
  // closing the tab/app, backgrounding it, or navigating away from the editor in the SPA. IndexedDB
  // writes are same-process and reliably complete even mid-unload; the multipart server upload (it
  // re-sends every used media file) is not guaranteed to finish in time, which is why beforeunload
  // also warns the user rather than relying on the flush alone.
  useEffect(() => {
    function flush() {
      if (statusRef.current === "saved") return;
      saveProject(stateRef.current.project).catch(() => {});
      saveProjectToServer(stateRef.current.project).catch(() => {});
    }
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (statusRef.current === "saved") return;
      flush();
      e.preventDefault();
      e.returnValue = "";
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") flush();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flush();
    };
  }, []);

  async function handleSaveNow() {
    setStatus("saving");
    try {
      await saveProject(state.project);
      await saveProjectToServer(state.project);
      pendingSinceRef.current = null;
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
