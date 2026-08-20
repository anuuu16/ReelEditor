declare global {
  namespace Express {
    interface Request {
      jobId?: string;
      resourceId?: string;
    }
  }
}

export {};
