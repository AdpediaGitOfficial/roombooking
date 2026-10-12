export type MaintenanceErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INVALID_TRANSITION" | "NOTE_REQUIRED";

export class MaintenanceError extends Error {
  constructor(
    public readonly code: MaintenanceErrorCode,
    message: string,
    public readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "MaintenanceError";
  }
}
