import type { PromptStudioTheme } from "./useTheme.js";

interface ThemeToggleProps {
  theme: PromptStudioTheme;
  onToggle: () => void;
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="rounded-ps border border-ps-border-strong bg-ps-elevated px-2.5 py-1.5 text-xs text-ps-text hover:border-ps-accent"
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
