export type AdminErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INVALID_STATE" | "GUARD";

export class AdminError extends Error {
  constructor(public readonly code: AdminErrorCode, message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "AdminError";
  }
}
