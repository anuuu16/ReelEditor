import type { ReactNode } from "react";

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="ie-section">
      <div className="ie-section-head">
        <h3>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A colour picker that can also mean "none" — for optional fills, strokes and backgrounds. */
export function ColorField({
  label,
  value,
  onChange,
  allowNone = false,
  fallback = "#ffffff",
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  allowNone?: boolean;
  fallback?: string;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="inline-fields ie-color-row">
        <input type="color" value={toHex(value ?? fallback)} disabled={value === null} onChange={(e) => onChange(e.target.value)} />
        {allowNone && (
          <button type="button" className={value === null ? "active" : ""} onClick={() => onChange(value === null ? fallback : null)}>
            {value === null ? "none" : "clear"}
          </button>
        )}
      </div>
    </div>
  );
}

/** A row of mutually-exclusive buttons. */
export function ChoiceRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const row = (
    <div className="inline-fields inline-fields-wrap">
      {options.map((option) => (
        <button key={option.id} type="button" className={value === option.id ? "active" : ""} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
  if (!label) return row;
  return (
    <div className="field">
      <span>{label}</span>
      {row}
    </div>
  );
}

// <input type="color"> only accepts #rrggbb; templates and defaults use rgba() for translucent
// fills, so those are shown as their opaque equivalent.
export function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (match) {
    return `#${[match[1], match[2], match[3]].map((c) => Number(c).toString(16).padStart(2, "0")).join("")}`;
  }
  return "#ffffff";
}

/** Extracts the alpha of an rgba() colour (1 for anything else). */
export function colorAlpha(color: string): number {
  const match = color.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i);
  return match ? Number(match[1]) : 1;
}

/** Combines a hex colour and an alpha into rgba() (or plain hex when fully opaque). */
export function withAlpha(color: string, alpha: number): string {
  const hex = toHex(color);
  if (alpha >= 1) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.round(alpha * 100) / 100})`;
}
