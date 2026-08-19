import { useState, type MouseEvent } from "react";

const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: "Space", description: "Play / pause" },
  { keys: "Delete / Backspace", description: "Remove the selected clip or overlay" },
  { keys: "Cmd/Ctrl + Z", description: "Undo" },
  { keys: "Cmd/Ctrl + Shift + Z", description: "Redo" },
  { keys: "Cmd/Ctrl + D", description: "Duplicate the selected clip" },
  { keys: "S", description: "Split the selected clip at the playhead" },
];

export function ShortcutsHelp() {
  const [isOpen, setIsOpen] = useState(false);

  function stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  if (!isOpen) {
    return (
      <button type="button" className="shortcuts-help-button" onClick={() => setIsOpen(true)} title="Keyboard shortcuts">
        ?
      </button>
    );
  }

  return (
    <div className="export-overlay" onClick={() => setIsOpen(false)}>
      <div className="export-panel" onClick={stopPropagation}>
        <button type="button" className="export-close" onClick={() => setIsOpen(false)} title="Close">
          ×
        </button>
        <h2>Keyboard shortcuts</h2>
        <ul className="shortcuts-list">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.keys} className="shortcuts-list-item">
              <kbd>{shortcut.keys}</kbd>
              <span>{shortcut.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
