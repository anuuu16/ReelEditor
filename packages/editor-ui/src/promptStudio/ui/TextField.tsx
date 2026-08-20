import type { ChangeEvent } from "react";

interface TextFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
}

export function TextField({ label, hint, value, onChange, onBlur, placeholder, readOnly, className }: TextFieldProps) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
  }

  return (
    <label className={`flex flex-col gap-1.5 text-xs text-ps-muted ${className ?? ""}`}>
      <span>
        {label}
        {hint && <span className="ml-1.5 text-ps-muted/70">{hint}</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onBlur={onBlur}
        placeholder={placeholder}
        readOnly={readOnly}
        className="w-full min-w-0 rounded-ps border border-ps-border bg-ps-elevated px-2.5 py-1.5 text-sm text-ps-text placeholder:text-ps-muted focus:border-ps-accent focus:outline-none read-only:opacity-70"
      />
    </label>
  );
}
