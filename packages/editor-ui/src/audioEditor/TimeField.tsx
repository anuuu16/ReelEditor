import { useState } from "react";

interface TimeFieldProps {
  label: string;
  seconds: number;
  min: number;
  max: number;
  onCommit: (seconds: number) => void;
}

// A number input for a seconds value that commits only on blur / Enter. A controlled input that
// re-clamped on every keystroke can't accept multi-digit entry — typing "9" toward "90" would be
// clamped the instant it's below the min. Here the field holds free text while focused and only
// parses + clamps when the user is done.
export function TimeField({ label, seconds, min, max, onCommit }: TimeFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? seconds.toFixed(2);

  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onCommit(Math.min(max, Math.max(min, parsed)));
    setDraft(null);
  };

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={0.01}
        value={display}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(null);
        }}
      />
    </label>
  );
}
