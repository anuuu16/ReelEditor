import { useState } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

export function CopyButton({ text, label = "Copy", className }: CopyButtonProps) {
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

  return (
    <button type="button" className={className ? `${className} prompt-studio-copy-button` : "prompt-studio-copy-button"} onClick={handleClick}>
      {copied ? "Copied" : label}
    </button>
  );
}
