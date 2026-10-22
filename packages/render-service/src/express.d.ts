declare global {
  namespace Express {
    interface Request {
      /** POST /render: the id of the upload folder this request's files go into (one per batch of outputs). */
      batchId?: string;
      resourceId?: string;
      audioEditId?: string;
      /**
       * Set by an upload route once its files have an owner (a job, a saved project …). Until then,
       * the connection closing for any reason — a rejected request, an aborted upload, a crash in a
       * later middleware — runs the cleanup registered with `onUploadAbandoned` (see uploadCleanup.ts).
       */
      uploadCommitted?: boolean;
    }
  }
}

export {};
