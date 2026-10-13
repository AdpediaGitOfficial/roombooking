export type StructureErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INVALID_STATE" | "CONFLICT";

export class StructureError extends Error {
  constructor(public readonly code: StructureErrorCode, message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "StructureError";
  }
}
