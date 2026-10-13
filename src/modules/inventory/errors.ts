export type InventoryErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INSUFFICIENT_STOCK" | "INVALID_STATE" | "CONFLICT";

export class InventoryError extends Error {
  constructor(public readonly code: InventoryErrorCode, message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "InventoryError";
  }
}
