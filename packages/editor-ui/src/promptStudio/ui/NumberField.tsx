import { useEffect, useState } from "react";

interface NumberFieldProps {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

const baseClass =
  "w-full min-w-0 rounded-ps border border-ps-border bg-ps-elevated px-2.5 py-1.5 text-sm text-ps-text placeholder:text-ps-muted focus:border-ps-accent focus:outline-none";

// The number-input bug that kept recurring this session (force-clamping mid-keystroke, or
// rendering "NaN" when the field is briefly empty while retyping) is fixed here once, structurally
// — the draft stays a free-form string while focused, and only gets parsed/clamped on blur.
export function NumberField({ label, hint, value, onChange, min, max, className }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const parsed = Math.round(Number(draft));
    const clamped = Number.isFinite(parsed)
      ? Math.max(min ?? -Infinity, Math.min(max ?? Infinity, parsed))
      : value;
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  }

  return (
    <label className={`flex flex-col gap-1.5 text-xs text-ps-muted ${className ?? ""}`}>
      <span>
        {label}
        {hint && <span className="ml-1.5 text-ps-muted/70">{hint}</span>}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={baseClass}
      />
    </label>
  );
}
