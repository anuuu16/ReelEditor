declare global {
  namespace Express {
    interface Request {
      jobId?: string;
      resourceId?: string;
      audioEditId?: string;
    }
  }
}

export {};
