declare global {
  namespace Express {
    interface Request {
      jobId?: string;
    }
  }
}

export {};
