export type KeyErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INVALID_STATE" | "CONFLICT";

export class KeyError extends Error {
  constructor(public readonly code: KeyErrorCode, message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "KeyError";
  }
}
