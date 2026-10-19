import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Every test run gets its own projects/exports folders under the OS temp dir, so the suite never
// touches (or depends on) the real ~/ReelStudioProjects on the machine running it; globalSetup.ts
// deletes them at the end. Files run one at a time: they share those folders (and ffmpeg).
export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ["src/test/globalSetup.ts"],
    env: {
      REEL_PROJECTS_ROOT: path.join(os.tmpdir(), `reel-studio-test-projects-${process.pid}`),
      REEL_EXPORTS_ROOT: path.join(os.tmpdir(), `reel-studio-test-exports-${process.pid}`),
    },
  },
});
