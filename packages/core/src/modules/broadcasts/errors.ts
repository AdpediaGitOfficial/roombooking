export type BroadcastErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INVALID_STATE";

export class BroadcastError extends Error {
  constructor(public readonly code: BroadcastErrorCode, message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "BroadcastError";
  }
}
