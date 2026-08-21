/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/promptStudio/**/*.{ts,tsx}"],
  // Preflight resets margins/fonts/etc. globally — this app's existing (non-Tailwind) components
  // rely on the browser defaults it would reset, so it stays off. Tailwind here is scoped to
  // Prompt Studio / Rhyme Studio only, via the content globs above and the ps- prefixed tokens.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        "ps-bg": "var(--ps-bg)",
        "ps-panel": "var(--ps-bg-panel)",
        "ps-elevated": "var(--ps-bg-elevated)",
        "ps-border": "var(--ps-border)",
        "ps-border-strong": "var(--ps-border-strong)",
        "ps-text": "var(--ps-text)",
        "ps-muted": "var(--ps-text-muted)",
        "ps-accent": "var(--ps-accent)",
        "ps-accent-contrast": "var(--ps-accent-contrast)",
        "ps-danger": "var(--ps-danger)",
        "ps-success": "var(--ps-success)",
        "ps-warning": "var(--ps-warning)",
      },
      borderRadius: {
        ps: "8px",
      },
    },
  },
  plugins: [],
};
