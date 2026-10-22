import type { NextFunction, Request, Response } from "express";
import multer from "multer";

// Uploads land on disk before the request has been looked at — multer writes the files, then the
// route decides whether it wants them. Every path out of a route that isn't "these files now
// belong to something" (bad JSON, a render plan that can't be built, the browser closing the tab
// mid-upload, multer giving up on a malformed body) used to leave the folder behind forever.
//
// `onUploadAbandoned` registers a cleanup to run when the response closes unless the route has
// called `commitUpload` first — the one hook covers every failure path, including the ones that
// never reach the route handler at all.

// When a connection drops mid-upload, multer's storage callbacks for the file being received can
// still land after the response has closed (its mkdir/createWriteStream are async), re-creating
// the folder the first cleanup just removed. A second pass a moment later catches that; the
// periodic orphan sweep (see jobStore.ts) is the backstop for anything slower still.
const LATE_CLEANUP_DELAY_MS = 1500;

export function onUploadAbandoned(req: Request, res: Response, cleanup: () => void): void {
  let ran = false;
  const runOnce = () => {
    if (ran || req.uploadCommitted) return;
    ran = true;
    cleanup();
    setTimeout(cleanup, LATE_CLEANUP_DELAY_MS).unref();
  };
  res.once("close", runOnce);
  res.once("finish", runOnce);
}

export function commitUpload(req: Request): void {
  req.uploadCommitted = true;
}

/** Express's default error page is HTML; every other response here is JSON, so errors are too. */
export function jsonErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const declared = typeof (err as { status?: number }).status === "number" ? (err as { status: number }).status : null;
  // multer's errors (a field over its limit, an unexpected file, a body that isn't the multipart
  // it claims to be) are all the request's fault, never ours.
  const status = declared ?? (err instanceof multer.MulterError ? 400 : 500);
  const message = err instanceof Error ? err.message : String(err);
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
}
