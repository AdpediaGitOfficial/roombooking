export type PeopleErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INVALID_STATE" | "CONFLICT";

export class PeopleError extends Error {
  constructor(public readonly code: PeopleErrorCode, message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "PeopleError";
  }
}
