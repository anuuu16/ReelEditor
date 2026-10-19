import path from "node:path";
import { defineConfig } from "@playwright/test";
import { APP_URL, E2E_EXPORTS_ROOT, E2E_PROJECTS_ROOT, RENDER_PORT, RENDER_URL } from "./e2e/env.js";

// End-to-end tests against the real app in Chromium: things that need an actual canvas (pixel
// comparisons, export encoding, drag performance) and the real render service with ffmpeg (video
// exports, the queue, autosave). Run with `pnpm test:e2e` after a `pnpm build`; the first run needs
// `npx playwright install chromium` (or PLAYWRIGHT_BROWSERS_PATH pointing at an existing install).
//
// Both servers are started fresh on their own ports (5199 / 4312, not the dev 5173 / 4310), with the
// render service pointed at a temp folder — nothing here touches ~/ReelStudioProjects.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: APP_URL,
    viewport: { width: 1600, height: 1000 },
    browserName: "chromium",
  },
  webServer: [
    {
      command: "pnpm exec vite --host 127.0.0.1 --port 5199 --strictPort",
      url: APP_URL,
      env: { VITE_RENDER_SERVICE_URL: RENDER_URL },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm exec tsx src/index.ts",
      cwd: path.resolve(import.meta.dirname, "../render-service"),
      url: `${RENDER_URL}/health`,
      env: { PORT: String(RENDER_PORT), REEL_PROJECTS_ROOT: E2E_PROJECTS_ROOT, REEL_EXPORTS_ROOT: E2E_EXPORTS_ROOT },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
