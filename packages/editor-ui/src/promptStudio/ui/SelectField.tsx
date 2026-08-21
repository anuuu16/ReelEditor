interface SelectFieldOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectFieldOption[];
  className?: string;
}

export function SelectField({ label, hint, value, onChange, options, className }: SelectFieldProps) {
  return (
    <label className={`flex flex-col gap-1.5 text-xs text-ps-muted ${className ?? ""}`}>
      <span>
        {label}
        {hint && <span className="ml-1.5 text-ps-muted/70">{hint}</span>}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 rounded-ps border border-ps-border bg-ps-elevated px-2.5 py-1.5 text-sm text-ps-text focus:border-ps-accent focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
