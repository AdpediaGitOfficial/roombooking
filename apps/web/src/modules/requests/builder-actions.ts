"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/authorize";
import { FORM_BUILDER_ROLES, assertPublishable, createDraft, createType, discardDraft, saveDraft, updateType } from "@sam/core/modules/requests/builder";
import { submitChange } from "@sam/core/modules/admin/change-requests";
import { RequestError } from "@sam/core/modules/requests/errors";

export type BuilderState = { error?: string; message?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };

function revalidate(typeId?: string) {
  revalidatePath("/admin/forms");
  revalidatePath("/my/requests/new");
  if (typeId) revalidatePath(`/admin/forms/${typeId}`);
}

function fail(error: unknown, values?: Record<string, string>): BuilderState {
  if (error instanceof RequestError) return { error: error.message, fieldErrors: error.fieldErrors, values };
  throw error;
}

export async function createTypeAction(_prev: BuilderState, formData: FormData): Promise<BuilderState> {
  const user = await requireRole(FORM_BUILDER_ROLES, "/admin/forms");
  const values = { code: str(formData, "code"), name: str(formData, "name"), description: str(formData, "description") };
  let id: string;
  try {
    id = (await createType({ organizationId: user.organizationId, actorId: user.id, ...values })).id;
  } catch (error) {
    return fail(error, values);
  }
  revalidate(id);
  redirect(`/admin/forms/${id}`);
}

export async function updateTypeAction(_prev: BuilderState, formData: FormData): Promise<BuilderState> {
  const user = await requireRole(FORM_BUILDER_ROLES, "/admin/forms");
  const typeId = str(formData, "typeId");
  const values = { name: str(formData, "name"), description: str(formData, "description"), status: str(formData, "status"), reminderAfterDays: str(formData, "reminderAfterDays"), escalateAfterDays: str(formData, "escalateAfterDays"), escalateToRole: str(formData, "escalateToRole"), expireAfterDays: str(formData, "expireAfterDays") };
  const num = (v: string) => (v === "" ? null : Number(v));
  try {
    await updateType({ typeId, actorId: user.id, name: values.name, description: values.description, status: values.status === "INACTIVE" ? "INACTIVE" : "ACTIVE", policy: { reminderAfterDays: num(values.reminderAfterDays), escalateAfterDays: num(values.escalateAfterDays), expireAfterDays: num(values.expireAfterDays), escalateToRole: (values.escalateToRole || null) as Role | null } });
  } catch (error) {
    return fail(error, values);
  }
  revalidate(typeId);
  return { message: "Saved.", values };
}

export async function createDraftAction(_prev: BuilderState, formData: FormData): Promise<BuilderState> {
  const user = await requireRole(FORM_BUILDER_ROLES, "/admin/forms");
  const typeId = str(formData, "typeId");
  try {
    await createDraft({ typeId, actorId: user.id });
  } catch (error) {
    return fail(error);
  }
  revalidate(typeId);
  return { message: "Draft created." };
}

/** Builder form: intent "save" keeps the draft, "publish" saves then publishes, "discard" deletes it. */
export async function draftAction(_prev: BuilderState, formData: FormData): Promise<BuilderState> {
  const user = await requireRole(FORM_BUILDER_ROLES, "/admin/forms");
  const typeId = str(formData, "typeId");
  const versionId = str(formData, "versionId");
  const intent = str(formData, "intent");
  const values = { schema: str(formData, "schema"), steps: str(formData, "steps"), changeNote: str(formData, "changeNote") };
  try {
    if (intent === "discard") {
      await discardDraft({ versionId, actorId: user.id });
      revalidate(typeId);
      return { message: "Draft discarded." };
    }
    const parse = (s: string) => { try { return JSON.parse(s || "null"); } catch { throw new RequestError("VALIDATION", "The builder sent malformed data; reload and try again."); } };
    await saveDraft({ versionId, actorId: user.id, schema: parse(values.schema), steps: parse(values.steps), changeNote: values.changeNote });
    if (intent === "publish") {
      // Publishing a route is a high-risk change: a second Super Admin approves it (document 6.3).
      await assertPublishable(versionId);
      const r = await submitChange({ organizationId: user.organizationId, actorId: user.id, summary: `Publish a new version of a request form${values.changeNote ? ` (${values.changeNote.slice(0, 80)})` : ""}`, payload: { op: "workflow.publish", versionId, changeNote: values.changeNote } });
      revalidate(typeId);
      revalidatePath("/admin/changes");
      return { message: r.status === "PENDING" ? "Submitted: a second Super Admin must approve publishing before residents see this version." : "Published. Residents now see this version.", values };
    }
  } catch (error) {
    return fail(error, values);
  }
  revalidate(typeId);
  return { message: "Draft saved.", values };
}
