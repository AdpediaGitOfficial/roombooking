export type FacilityErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "RULE" | "CAPACITY" | "INVALID_STATE";

export class FacilityError extends Error {
  constructor(public readonly code: FacilityErrorCode, message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "FacilityError";
  }
}
