interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** How the value renders next to the label, e.g. (v) => `${Math.round(v * 100)}%`. Defaults to the raw number. */
  format?: (value: number) => string;
}

// A range slider paired with a plain number input showing the same value — the slider is fast for
// rough adjustment, the number box is there whenever an exact/custom value matters more than feel.
export function SliderField({ label, value, min, max, step, onChange, format }: SliderFieldProps) {
  function clamp(v: number): number {
    if (Number.isNaN(v)) return value;
    return Math.min(max, Math.max(min, v));
  }

  return (
    <label className="field slider-field">
      <span>
        {label} — {format ? format(value) : value}
      </span>
      <div className="slider-field-row">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(clamp(Number(e.target.value)))} />
        <input
          type="number"
          className="slider-field-number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
        />
      </div>
    </label>
  );
}
