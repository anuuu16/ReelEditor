import { defineConfig } from "@playwright/test";

// End-to-end tests against the real app in Chromium: things that need an actual canvas (pixel
// comparisons, export encoding, drag performance). Run with `pnpm test:e2e`; the first run needs
// `npx playwright install chromium` (or PLAYWRIGHT_BROWSERS_PATH pointing at an existing install).
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5199",
    viewport: { width: 1600, height: 1000 },
    browserName: "chromium",
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 5199 --strictPort",
    url: "http://127.0.0.1:5199",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
