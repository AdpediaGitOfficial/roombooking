"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth/authorize";
import { BROADCAST_ROLES } from "@sam/core/modules/broadcasts/access";
import { parseAudience } from "@sam/core/modules/broadcasts/rules";

export type FormState = { error?: string; message?: string; fieldErrors?: Record<string, string>; values?: Record<string, string>; preview?: { count: number; sample: string[] } };

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };
const list = (fd: FormData, k: string) => fd.getAll(k).filter((v): v is string => typeof v === "string" && v.length > 0);

function read(fd: FormData) {
  const audience = parseAudience({ roles: list(fd, "roles"), siteIds: list(fd, "siteIds"), buildingIds: list(fd, "buildingIds") });
  const values: Record<string, string> = { title: str(fd, "title"), body: str(fd, "body"), emailCopy: str(fd, "emailCopy"), whatsappCopy: str(fd, "whatsappCopy"), roles: audience.roles.join(","), siteIds: audience.siteIds.join(","), buildingIds: audience.buildingIds.join(",") };
  return { audience, values, input: { title: values.title, body: values.body, audience, emailCopy: values.emailCopy === "on", whatsappCopy: values.whatsappCopy === "on" } };
}

function revalidate(id?: string) {
  revalidatePath("/admin/broadcasts");
  revalidatePath("/my");
  revalidatePath("/my/announcements");
  if (id) revalidatePath(`/admin/broadcasts/${id}`);
}

function fail(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof ApiError && error.status < 500) return { error: error.message, fieldErrors: error.fieldErrors, values };
  throw error;
}

/** Compose form: "preview" counts the audience, "draft" saves, "send" saves and sends. */
export async function composeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(BROADCAST_ROLES, "/admin/broadcasts");
  const intent = str(formData, "intent");
  const broadcastId = str(formData, "broadcastId");
  const { audience, values, input } = read(formData);
  if (intent === "preview") {
    return { values, preview: await api.broadcasts.preview({ audience }) };
  }
  let id: string;
  try {
    ({ id } = await api.broadcasts.save({ broadcastId: broadcastId || undefined, ...input, send: intent === "send" }));
  } catch (error) {
    // A draft that was saved before the send failed keeps its id, so a retry updates it.
    const savedId = error instanceof ApiError && typeof error.details.broadcastId === "string" ? error.details.broadcastId : broadcastId;
    return fail(error, { ...values, broadcastId: savedId });
  }
  revalidate(id);
  redirect(`/admin/broadcasts/${id}`);
}

export async function sendAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(BROADCAST_ROLES, "/admin/broadcasts");
  const id = str(formData, "broadcastId");
  try {
    const { recipients } = await api.broadcasts.send({ id });
    revalidate(id);
    return { message: `Sent to ${recipients} ${recipients === 1 ? "person" : "people"}.` };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(BROADCAST_ROLES, "/admin/broadcasts");
  const id = str(formData, "broadcastId");
  try {
    await api.broadcasts.cancel({ id });
  } catch (error) {
    return fail(error);
  }
  revalidate(id);
  return { message: "Draft cancelled." };
}
