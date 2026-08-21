interface ChipProps {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

export function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full border border-ps-accent bg-ps-accent px-3 py-1.5 text-xs text-ps-accent-contrast"
          : "rounded-full border border-ps-border-strong bg-ps-elevated px-3 py-1.5 text-xs text-ps-muted hover:border-ps-accent hover:text-ps-text"
      }
    >
      {children}
    </button>
  );
}
