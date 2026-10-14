import "server-only";
import { NextResponse } from "next/server";
import { ApiError, type FileResult } from "@sam/contract/index";

/** Turns a file returned by the API into a download (or inline) response for the browser. */
export function fileResponse(file: FileResult, disposition: "attachment" | "inline" = "attachment", fallbackName = "download") {
  const name = (file.fileName ?? fallbackName).replace(/"/g, "");
  return new NextResponse(file.body as BodyInit, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.body.length),
      "Content-Disposition": `${disposition}; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Maps an API refusal on a download route to the matching HTTP status; anything else surfaces as a failure. */
export function apiFailure(error: unknown): NextResponse {
  if (error instanceof ApiError && error.status < 500) {
    return NextResponse.json({ error: error.status === 401 ? "unauthenticated" : error.status === 403 ? "forbidden" : "not found" }, { status: error.status === 401 || error.status === 403 ? error.status : 404 });
  }
  throw error;
}
