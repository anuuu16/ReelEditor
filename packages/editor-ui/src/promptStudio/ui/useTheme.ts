import { useEffect, useState } from "react";

export type PromptStudioTheme = "dark" | "light";

const STORAGE_KEY = "promptStudio.theme";

function readStoredTheme(): PromptStudioTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

// Dark matches this app's existing look everywhere else, so it stays the default here too;
// light is an explicit opt-in, persisted so it sticks across visits.
export function usePromptStudioTheme(): [PromptStudioTheme, () => void] {
  const [theme, setTheme] = useState<PromptStudioTheme>(readStoredTheme);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage unavailable (private mode, etc.) — theme just won't persist across reloads.
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  return [theme, toggleTheme];
}
