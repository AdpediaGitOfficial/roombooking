"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, requireUser } from "@/lib/auth/authorize";
import { FACILITY_MANAGE_ROLES, FACILITY_OPERATE_ROLES } from "@sam/core/modules/facilities/access";
import { actorFor } from "./context";
import { FacilityError } from "@sam/core/modules/facilities/errors";
import { validateHoursInput, validateRulesInput } from "@sam/core/modules/facilities/rules";
import { amendBooking, cancelBooking, createBooking, createFacility, decideBooking, recordAttendance, updateFacility } from "@sam/core/modules/facilities/service";

export type FormState = { error?: string; message?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
export type ActionState = { error?: string; message?: string };

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };
const int = (fd: FormData, k: string) => { const n = Number(str(fd, k)); return Number.isFinite(n) ? Math.trunc(n) : NaN; };

function revalidate(facilityId?: string, extra: string[] = []) {
  revalidatePath("/facilities");
  revalidatePath("/my/facilities");
  revalidatePath("/my");
  if (facilityId) { revalidatePath(`/facilities/${facilityId}`); revalidatePath(`/my/facilities/${facilityId}`); }
  for (const p of extra) if (p.startsWith("/")) revalidatePath(p);
}

function fail(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof FacilityError) return { error: error.message, fieldErrors: error.fieldErrors, values };
  throw error;
}

export async function createBookingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/my/facilities");
  const actor = actorFor(user);
  const values: Record<string, string> = {};
  for (const k of ["facilityId", "date", "startTime", "durationMinutes", "headcount", "purpose", "userId", "idempotencyKey", "returnPath"]) values[k] = str(formData, k);
  const userId = values.userId || user.id;
  try {
    const { booking, duplicate } = await createBooking({ facilityId: values.facilityId, userId, actor, date: values.date, startTime: values.startTime, durationMinutes: int(formData, "durationMinutes"), headcount: int(formData, "headcount") || 1, purpose: values.purpose || null, idempotencyKey: values.idempotencyKey || null });
    revalidate(values.facilityId, [values.returnPath]);
    const when = `${values.date} at ${values.startTime}`;
    if (duplicate) return { message: `Already booked for ${when}.` };
    return { message: booking.status === "PENDING_APPROVAL" ? `Request sent for ${when}. You will be notified once it is approved.` : `Booked for ${when}.` };
  } catch (error) {
    return fail(error, values);
  }
}

export async function amendBookingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/my/facilities");
  const values: Record<string, string> = {};
  for (const k of ["bookingId", "facilityId", "date", "startTime", "durationMinutes", "headcount", "returnPath"]) values[k] = str(formData, k);
  try {
    await amendBooking({ bookingId: values.bookingId, actor: actorFor(user), date: values.date, startTime: values.startTime, durationMinutes: int(formData, "durationMinutes"), headcount: int(formData, "headcount") || 1 });
    revalidate(values.facilityId, [values.returnPath]);
    return { message: `Moved to ${values.date} at ${values.startTime}.` };
  } catch (error) {
    return fail(error, values);
  }
}

export async function cancelBookingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/my/facilities");
  try {
    await cancelBooking({ bookingId: str(formData, "bookingId"), actor: actorFor(user), reason: str(formData, "reason") || null });
  } catch (error) {
    if (error instanceof FacilityError) return { error: error.message };
    throw error;
  }
  revalidate(str(formData, "facilityId"), [str(formData, "returnPath")]);
  return { message: "Booking cancelled." };
}

export async function decideBookingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(FACILITY_MANAGE_ROLES, "/facilities");
  const approve = str(formData, "decision") === "approve";
  try {
    await decideBooking({ bookingId: str(formData, "bookingId"), actor: actorFor(user), approve, note: str(formData, "note") || null });
  } catch (error) {
    if (error instanceof FacilityError) return { error: error.message };
    throw error;
  }
  revalidate(str(formData, "facilityId"));
  return { message: approve ? "Booking approved." : "Booking declined." };
}

export async function attendanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(FACILITY_OPERATE_ROLES, "/facilities");
  const attended = str(formData, "attended") === "yes";
  try {
    await recordAttendance({ bookingId: str(formData, "bookingId"), actor: actorFor(user), attended });
  } catch (error) {
    if (error instanceof FacilityError) return { error: error.message };
    throw error;
  }
  revalidate(str(formData, "facilityId"));
  return { message: attended ? "Marked as used." : "Marked as no-show." };
}

export async function updateFacilityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole(FACILITY_MANAGE_ROLES, "/facilities");
  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") values[k] = v.trim();
  const { hours, errors: hourErrors } = validateHoursInput(values);
  const { rules, errors: ruleErrors } = validateRulesInput(values);
  const fieldErrors = { ...hourErrors, ...ruleErrors };
  if (Object.keys(fieldErrors).length) return { error: "Please correct the highlighted fields.", fieldErrors, values };
  try {
    await updateFacility({ facilityId: values.facilityId, actorId: user.id, name: values.name ?? "", location: values.location || null, description: values.description || null, capacity: int(formData, "capacity"), requiresApproval: values.requiresApproval === "on", status: values.status === "INACTIVE" ? "INACTIVE" : "ACTIVE", hours, rules });
  } catch (error) {
    return fail(error, values);
  }
  revalidate(values.facilityId);
  return { message: "Facility settings saved.", values };
}

export async function createFacilityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole(FACILITY_MANAGE_ROLES, "/facilities");
  const values: Record<string, string> = {};
  for (const k of ["siteId", "code", "name", "capacity"]) values[k] = str(formData, k);
  let id: string;
  try {
    const f = await createFacility({ siteId: values.siteId, actorId: user.id, code: values.code, name: values.name, capacity: int(formData, "capacity") });
    id = f.id;
  } catch (error) {
    return fail(error, values);
  }
  revalidate(id);
  redirect(`/facilities/${id}`);
}
