import { useState } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}

export function CopyButton({ text, label = "Copy", className, disabled }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard API unavailable or denied, fail silently.
    }
  }

  const baseClass =
    "rounded-ps border border-ps-border-strong bg-ps-elevated px-3 py-1.5 text-xs font-medium text-ps-text hover:border-ps-accent disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <button
      type="button"
      className={className ? `${baseClass} ${className}` : baseClass}
      onClick={handleClick}
      disabled={disabled}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
