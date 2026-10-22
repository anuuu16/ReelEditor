import path from "node:path";

// Imported first by app.ts, so .env is in process.env before any other module reads it at import
// time (the exports/projects folders, the queue size — see jobStore.ts, projects.ts, queue.ts).
//
// Only /studio/:id/generate needs an API key — everything else works with no .env at all. Loaded
// from the repo root (not this package's own directory, and not CWD) so there's a single .env to
// manage for the whole monorepo regardless of how this process was launched.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env file, or an old Node without loadEnvFile — fine, that endpoint just isn't usable yet.
}
