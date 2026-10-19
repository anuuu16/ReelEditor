import { rmSync } from "node:fs";
import type { TestProject } from "vitest/node";

// Removes the per-run temp folders vitest.config.ts points the service at, once every file is done.
export default function setup(project: TestProject): () => void {
  const roots = [project.config.env.REEL_PROJECTS_ROOT, project.config.env.REEL_EXPORTS_ROOT].filter(
    (root): root is string => typeof root === "string" && root.includes("reel-studio-test-"),
  );
  return () => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  };
}
