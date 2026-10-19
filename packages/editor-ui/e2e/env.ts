import os from "node:os";
import path from "node:path";

// Shared by playwright.config.ts (which starts the servers with these) and the specs (which look
// at what the render service wrote to disk), so the two can never disagree.
export const E2E_ROOT = path.join(os.tmpdir(), "reel-studio-e2e");
export const E2E_PROJECTS_ROOT = path.join(E2E_ROOT, "projects");
export const E2E_EXPORTS_ROOT = path.join(E2E_ROOT, "exports");
export const RENDER_PORT = 4312;
export const RENDER_URL = `http://127.0.0.1:${RENDER_PORT}`;
export const APP_URL = "http://127.0.0.1:5199";
