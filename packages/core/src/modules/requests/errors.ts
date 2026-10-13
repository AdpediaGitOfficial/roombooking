export type RequestErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INVALID_STATE" | "SELF_APPROVAL" | "COMMENT_REQUIRED" | "CONFLICT";

export class RequestError extends Error {
  constructor(
    public readonly code: RequestErrorCode,
    message: string,
    public readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "RequestError";
  }
}
