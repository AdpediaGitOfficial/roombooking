export type AuthErrorCode = "VALIDATION" | "INVALID_CREDENTIALS" | "LOCKED" | "INACTIVE";

export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode, message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "AuthError";
  }
}
