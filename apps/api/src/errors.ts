import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AccommodationError } from "@sam/core/modules/accommodation/errors";
import { AdminError } from "@sam/core/modules/admin/errors";
import { AllocationError } from "@sam/core/modules/allocations/errors";
import { AuthError } from "@sam/core/modules/auth/errors";
import { BroadcastError } from "@sam/core/modules/broadcasts/errors";
import { FacilityError } from "@sam/core/modules/facilities/errors";
import { ImportError } from "@sam/core/modules/imports/service";
import { InventoryError } from "@sam/core/modules/inventory/errors";
import { KeyError } from "@sam/core/modules/keys/errors";
import { LostFoundError } from "@sam/core/modules/lost-found/errors";
import { MaintenanceError } from "@sam/core/modules/maintenance/errors";
import { RequestError } from "@sam/core/modules/requests/errors";
import { SelfServiceError } from "@sam/core/modules/self-service/service";
import { UploadError } from "@sam/core/lib/uploads";
import { HttpError } from "./http-error";

const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INACTIVE: 403,
  SELF_APPROVAL: 403,
  INVALID_CREDENTIALS: 401,
  LOCKED: 423,
  VALIDATION: 422,
  HAS_ERRORS: 422,
  NOTE_REQUIRED: 422,
  COMMENT_REQUIRED: 422,
};

type CodedError = Error & { code: string; fieldErrors?: Record<string, string>; details?: Record<string, unknown> };

/** Turns anything thrown by a service or a library into an HttpError, or null when it is unexpected. */
export function toHttpError(error: unknown): HttpError | null {
  if (error instanceof HttpError) return error;
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) fieldErrors[issue.path.join(".") || "_"] ??= issue.message;
    return new HttpError(422, "VALIDATION", "Some fields are not valid.", fieldErrors);
  }
  if (
    error instanceof AccommodationError || error instanceof AdminError || error instanceof AllocationError || error instanceof AuthError || error instanceof BroadcastError ||
    error instanceof FacilityError || error instanceof ImportError || error instanceof InventoryError || error instanceof KeyError ||
    error instanceof LostFoundError || error instanceof MaintenanceError || error instanceof RequestError
  ) {
    const e = error as CodedError;
    return new HttpError(STATUS_BY_CODE[e.code] ?? 409, e.code, e.message, e.fieldErrors ?? {}, e.details);
  }
  if (error instanceof SelfServiceError) return new HttpError(422, "VALIDATION", error.message);
  if (error instanceof UploadError) return new HttpError(422, "UPLOAD", error.message);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return new HttpError(409, "CONFLICT", "That record already exists.");
    if (error.code === "P2025") return new HttpError(404, "NOT_FOUND", "That record was not found.");
    if (error.code === "P2034") return new HttpError(409, "CONFLICT", "The data changed at the same moment. Try again.");
  }
  return null;
}
