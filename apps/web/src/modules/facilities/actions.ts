"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth/authorize";
import { FACILITY_MANAGE_ROLES, FACILITY_OPERATE_ROLES } from "@sam/core/modules/facilities/access";

export type FormState = { error?: string; message?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
export type ActionState = { error?: string; message?: string };

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };
/** A whole number from a form field; 0 when blank or not a number, which the API rejects with its usual message. */
const int = (fd: FormData, k: string) => { const n = Number(str(fd, k)); return Number.isFinite(n) ? Math.trunc(n) : 0; };

function revalidate(facilityId?: string, extra: string[] = []) {
  revalidatePath("/facilities");
  revalidatePath("/my/facilities");
  revalidatePath("/my");
  if (facilityId) { revalidatePath(`/facilities/${facilityId}`); revalidatePath(`/my/facilities/${facilityId}`); }
  for (const p of extra) if (p.startsWith("/")) revalidatePath(p);
}

function fail(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof ApiError && error.status < 500) return { error: error.message, fieldErrors: error.fieldErrors, values };
  throw error;
}

export async function createBookingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser("/my/facilities");
  const values: Record<string, string> = {};
  for (const k of ["facilityId", "date", "startTime", "durationMinutes", "headcount", "purpose", "userId", "idempotencyKey", "returnPath"]) values[k] = str(formData, k);
  try {
    const { booking, duplicate } = await api.facilities.book({ id: values.facilityId, userId: values.userId || undefined, date: values.date, startTime: values.startTime, durationMinutes: int(formData, "durationMinutes"), headcount: int(formData, "headcount") || 1, purpose: values.purpose || undefined, idempotencyKey: values.idempotencyKey || undefined });
    revalidate(values.facilityId, [values.returnPath]);
    const when = `${values.date} at ${values.startTime}`;
    if (duplicate) return { message: `Already booked for ${when}.` };
    return { message: booking.status === "PENDING_APPROVAL" ? `Request sent for ${when}. You will be notified once it is approved.` : `Booked for ${when}.` };
  } catch (error) {
    return fail(error, values);
  }
}

export async function amendBookingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser("/my/facilities");
  const values: Record<string, string> = {};
  for (const k of ["bookingId", "facilityId", "date", "startTime", "durationMinutes", "headcount", "returnPath"]) values[k] = str(formData, k);
  try {
    await api.facilities.amend({ id: values.bookingId, date: values.date, startTime: values.startTime, durationMinutes: int(formData, "durationMinutes"), headcount: int(formData, "headcount") || 1 });
    revalidate(values.facilityId, [values.returnPath]);
    return { message: `Moved to ${values.date} at ${values.startTime}.` };
  } catch (error) {
    return fail(error, values);
  }
}

export async function cancelBookingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser("/my/facilities");
  try {
    await api.facilities.cancel({ id: str(formData, "bookingId"), reason: str(formData, "reason") || undefined });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    throw error;
  }
  revalidate(str(formData, "facilityId"), [str(formData, "returnPath")]);
  return { message: "Booking cancelled." };
}

export async function decideBookingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(FACILITY_MANAGE_ROLES, "/facilities");
  const approve = str(formData, "decision") === "approve";
  try {
    await api.facilities.decide({ id: str(formData, "bookingId"), approve, note: str(formData, "note") || undefined });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    throw error;
  }
  revalidate(str(formData, "facilityId"));
  return { message: approve ? "Booking approved." : "Booking declined." };
}

export async function attendanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(FACILITY_OPERATE_ROLES, "/facilities");
  const attended = str(formData, "attended") === "yes";
  try {
    await api.facilities.attendance({ id: str(formData, "bookingId"), attended });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    throw error;
  }
  revalidate(str(formData, "facilityId"));
  return { message: attended ? "Marked as used." : "Marked as no-show." };
}

export async function updateFacilityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(FACILITY_MANAGE_ROLES, "/facilities");
  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") values[k] = v.trim();
  try {
    await api.facilities.update({ id: values.facilityId, fields: values });
  } catch (error) {
    return fail(error, values);
  }
  revalidate(values.facilityId);
  return { message: "Facility settings saved.", values };
}

export async function createFacilityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(FACILITY_MANAGE_ROLES, "/facilities");
  const values: Record<string, string> = {};
  for (const k of ["siteId", "code", "name", "capacity"]) values[k] = str(formData, k);
  let id: string;
  try {
    const f = await api.facilities.create({ siteId: values.siteId, code: values.code, name: values.name, capacity: int(formData, "capacity") });
    id = f.id;
  } catch (error) {
    return fail(error, values);
  }
  revalidate(id);
  redirect(`/facilities/${id}`);
}
