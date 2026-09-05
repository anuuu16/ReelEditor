import { useState } from "react";
import type { TimelineNote } from "./timeline.js";

interface NoteMarkerProps {
  note: TimelineNote;
  leftPx: number;
  open: boolean;
  onToggle: () => void;
  onChangeText: (text: string) => void;
  onDelete: () => void;
}

// A time-anchored comment pin on the timeline (see TimelineNote) — click the flag to open a small
// popover with a free-text note, e.g. "AI extended music starts here".
export function NoteMarker({ note, leftPx, open, onToggle, onChangeText, onDelete }: NoteMarkerProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="ae-note" style={{ left: leftPx }} onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`ae-note-flag${note.text ? " has-text" : ""}`}
        onClick={onToggle}
        title={note.text || "Note"}
      >
        ⚑
      </button>
      {open && (
        <div className="ae-note-popover">
          <textarea
            autoFocus
            rows={3}
            value={draft ?? note.text}
            placeholder="Note…"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== null) onChangeText(draft);
              setDraft(null);
            }}
          />
          <div className="ae-note-popover-actions">
            <button type="button" className="ae-danger" onClick={onDelete}>
              Delete
            </button>
            <button type="button" onClick={onToggle}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
