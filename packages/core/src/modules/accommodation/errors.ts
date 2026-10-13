export type AccommodationErrorCode = "NOT_FOUND" | "VALIDATION" | "INVALID_STATE";

export class AccommodationError extends Error {
  constructor(public readonly code: AccommodationErrorCode, message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "AccommodationError";
  }
}
