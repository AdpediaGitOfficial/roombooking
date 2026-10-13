export type BroadcastErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INVALID_STATE";

export class BroadcastError extends Error {
  constructor(public readonly code: BroadcastErrorCode, message: string, public readonly fieldErrors: Record<string, string> = {}, public details?: Record<string, unknown>) {
    super(message);
    this.name = "BroadcastError";
  }
}
