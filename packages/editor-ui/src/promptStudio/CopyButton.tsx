import { useState } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}

// Falls back to the old execCommand("copy") trick via a hidden textarea when the async Clipboard
// API is unavailable or throws (e.g. NotAllowedError from a focus/permissions quirk) — the
// previous version just returned/caught silently on either failure, so a failed copy looked
// identical to a successful one: the button did nothing and nobody could tell why.
function legacyCopy(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

export function CopyButton({ text, label = "Copy", className, disabled }: CopyButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function handleClick() {
    let ok = false;
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok) ok = legacyCopy(text);

    setStatus(ok ? "copied" : "failed");
    setTimeout(() => setStatus("idle"), 1400);
  }

  const baseClass =
    "rounded-ps border border-ps-border-strong bg-ps-elevated px-3 py-1.5 text-xs font-medium text-ps-text hover:border-ps-accent disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <button
      type="button"
      className={className ? `${baseClass} ${className}` : baseClass}
      onClick={handleClick}
      disabled={disabled}
      title={status === "failed" ? "Copy failed — select and copy the text manually" : undefined}
    >
      {status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : label}
    </button>
  );
}
