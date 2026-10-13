/** Thrown by the client when the API answers with an error status. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors: Record<string, string> = {},
    public readonly requestId?: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ErrorBody = { error: { code: string; message: string; fieldErrors?: Record<string, string>; requestId?: string; details?: Record<string, unknown> } };
