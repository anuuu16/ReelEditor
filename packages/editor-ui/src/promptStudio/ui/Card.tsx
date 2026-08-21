interface CardProps {
  title?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export function Card({ title, hint, children, className }: CardProps) {
  return (
    <section className={`rounded-ps border border-ps-border bg-ps-panel p-4 ${className ?? ""}`}>
      {title && <h2 className="mb-1 text-sm font-semibold text-ps-text">{title}</h2>}
      {hint && <p className="mb-3 text-xs text-ps-muted">{hint}</p>}
      {children}
    </section>
  );
}
