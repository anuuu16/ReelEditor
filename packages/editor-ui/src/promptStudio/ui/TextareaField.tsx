import type { ChangeEvent } from "react";

interface TextareaFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
  className?: string;
}

export function TextareaField({ label, hint, value, onChange, onBlur, placeholder, rows = 4, readOnly, className }: TextareaFieldProps) {
  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
  }

  return (
    <label className={`flex flex-col gap-1.5 text-xs text-ps-muted ${className ?? ""}`}>
      {(label || hint) && (
        <span>
          {label}
          {hint && <span className="ml-1.5 text-ps-muted/70">{hint}</span>}
        </span>
      )}
      <textarea
        value={value}
        onChange={handleChange}
        onBlur={onBlur}
        placeholder={placeholder}
        rows={rows}
        readOnly={readOnly}
        className="w-full min-w-0 resize-y rounded-ps border border-ps-border bg-ps-elevated px-2.5 py-1.5 text-sm text-ps-text placeholder:text-ps-muted focus:border-ps-accent focus:outline-none read-only:opacity-70"
      />
    </label>
  );
}
