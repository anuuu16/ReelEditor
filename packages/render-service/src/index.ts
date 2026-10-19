import { app, jobsRestored } from "./app.js";
import { listJobs } from "./jobs.js";
import { EXPORTS_ROOT } from "./jobStore.js";
import { getRenderQueue } from "./queue.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4310;

// Only starts answering once every export from before the restart is back in the registry —
// otherwise the editor's first "what's the state of my export?" after a restart would get a 404.
jobsRestored.then(() => {
  app.listen(PORT, () => {
    console.log(`render-service listening on http://localhost:${PORT}`);
    console.log(`exports kept in ${EXPORTS_ROOT} (queue: ${getRenderQueue().capacity} slots)`);
    const active = listJobs().filter((job) => job.status === "queued" || job.status === "running").length;
    if (active > 0) console.log(`${active} export(s) in progress`);
  });
});

// On the way out, every running ffmpeg is killed rather than left as an orphan — their jobs are
// still recorded as running on disk, so the next start picks them up and renders them again.
// Exiting synchronously (before any "close" event fires) is what keeps them from being marked as
// failed first.
function shutdown() {
  for (const job of listJobs()) job.process?.kill("SIGKILL");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
