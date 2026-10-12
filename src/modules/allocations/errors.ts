export type AllocationErrorCode =
  | "NOT_FOUND"
  | "STAFF_INACTIVE"
  | "BED_UNAVAILABLE"
  | "GENDER_POLICY"
  | "INVALID_DATES"
  | "STAFF_ALREADY_ALLOCATED"
  | "BED_OCCUPIED"
  | "INVALID_STATE"
  | "CLEARANCE_BLOCKED"
  | "FORBIDDEN";

export class AllocationError extends Error {
  constructor(
    public readonly code: AllocationErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AllocationError";
  }
}
