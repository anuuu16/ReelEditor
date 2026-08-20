import { useEffect, type ReactNode } from "react";

interface ClipContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export function ClipContextMenu({ x, y, onClose, children }: ClipContextMenuProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - 40);

  return (
    <div className="clip-context-backdrop" onClick={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div className="clip-context-menu" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ClipContextMenuItem({
  icon,
  label,
  onSelect,
  disabled,
  destructive,
}: {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      className={`clip-context-item${destructive ? " destructive" : ""}`}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="clip-context-item-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export function ClipContextMenuDivider() {
  return <div className="clip-context-divider" />;
}
