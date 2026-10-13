"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth/authorize";
import { FORM_BUILDER_ROLES } from "@sam/core/modules/requests/builder-rules";

export type BuilderState = { error?: string; message?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };

type Role = NonNullable<Parameters<typeof api.forms.updateType>[0]["escalateToRole"]>;
const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };

function revalidate(typeId?: string) {
  revalidatePath("/admin/forms");
  revalidatePath("/my/requests/new");
  if (typeId) revalidatePath(`/admin/forms/${typeId}`);
}

function fail(error: unknown, values?: Record<string, string>): BuilderState {
  if (error instanceof ApiError && error.status < 500) return { error: error.message, fieldErrors: error.fieldErrors, values };
  throw error;
}

export async function createTypeAction(_prev: BuilderState, formData: FormData): Promise<BuilderState> {
  await requireRole(FORM_BUILDER_ROLES, "/admin/forms");
  const values = { code: str(formData, "code"), name: str(formData, "name"), description: str(formData, "description") };
  let id: string;
  try {
    id = (await api.forms.createType({ code: values.code, name: values.name, description: values.description || undefined })).id;
  } catch (error) {
    return fail(error, values);
  }
  revalidate(id);
  redirect(`/admin/forms/${id}`);
}

export async function updateTypeAction(_prev: BuilderState, formData: FormData): Promise<BuilderState> {
  await requireRole(FORM_BUILDER_ROLES, "/admin/forms");
  const typeId = str(formData, "typeId");
  const values = { name: str(formData, "name"), description: str(formData, "description"), status: str(formData, "status"), reminderAfterDays: str(formData, "reminderAfterDays"), escalateAfterDays: str(formData, "escalateAfterDays"), escalateToRole: str(formData, "escalateToRole"), expireAfterDays: str(formData, "expireAfterDays") };
  const num = (v: string) => (v === "" ? null : Number(v));
  try {
    await api.forms.updateType({
      id: typeId, name: values.name, description: values.description || undefined, status: values.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      reminderAfterDays: num(values.reminderAfterDays), escalateAfterDays: num(values.escalateAfterDays), expireAfterDays: num(values.expireAfterDays), escalateToRole: (values.escalateToRole || null) as Role | null,
    });
  } catch (error) {
    return fail(error, values);
  }
  revalidate(typeId);
  return { message: "Saved.", values };
}

export async function createDraftAction(_prev: BuilderState, formData: FormData): Promise<BuilderState> {
  await requireRole(FORM_BUILDER_ROLES, "/admin/forms");
  const typeId = str(formData, "typeId");
  try {
    await api.forms.createDraft({ id: typeId });
  } catch (error) {
    return fail(error);
  }
  revalidate(typeId);
  return { message: "Draft created." };
}

/** Builder form: intent "save" keeps the draft, "publish" saves then publishes, "discard" deletes it. */
export async function draftAction(_prev: BuilderState, formData: FormData): Promise<BuilderState> {
  await requireRole(FORM_BUILDER_ROLES, "/admin/forms");
  const typeId = str(formData, "typeId");
  const versionId = str(formData, "versionId");
  const intent = str(formData, "intent");
  const values = { schema: str(formData, "schema"), steps: str(formData, "steps"), changeNote: str(formData, "changeNote") };
  try {
    if (intent === "discard") {
      await api.forms.discardDraft({ id: versionId });
      revalidate(typeId);
      return { message: "Draft discarded." };
    }
    let schema: unknown;
    let steps: unknown;
    try {
      schema = JSON.parse(values.schema || "null");
      steps = JSON.parse(values.steps || "null");
    } catch {
      return { error: "The builder sent malformed data; reload and try again.", values };
    }
    await api.forms.saveDraft({ id: versionId, schema, steps, changeNote: values.changeNote || undefined, publish: intent === "publish" });
  } catch (error) {
    return fail(error, values);
  }
  revalidate(typeId);
  return { message: intent === "publish" ? "Published. Residents now see this version." : "Draft saved.", values };
}
