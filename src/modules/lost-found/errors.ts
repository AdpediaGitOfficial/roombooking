export type LostFoundErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INVALID_STATE" | "CONFLICT";

export class LostFoundError extends Error {
  constructor(public readonly code: LostFoundErrorCode, message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "LostFoundError";
  }
}
