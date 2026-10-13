export type SecurityErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INVALID_STATE" | "DENIED";

export class SecurityError extends Error {
  constructor(public readonly code: SecurityErrorCode, message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "SecurityError";
  }
}
