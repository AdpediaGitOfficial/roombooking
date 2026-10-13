"use server";

import type { IntegrationKind } from "@prisma/client";
import { actorOf, requireUser } from "@/lib/auth/authorize";
import { runDomain, str, opt, list, type ActionState } from "@/lib/action-state";
import { configureIntegration, createApiKey, createWebhook, revokeApiKey, setWebhookActive, syncHrms, type HrmsRecord } from "@sam/core/modules/integrations/service";

const P = ["/admin/integrations"];
export type KeyState = ActionState & { token?: string; secret?: string };

export async function configureAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/integrations");
  return runDomain(async () => {
    let settings: Record<string, unknown> | undefined;
    const raw = opt(fd, "settings");
    if (raw) { try { settings = JSON.parse(raw); } catch { throw Object.assign(new Error("Settings must be valid JSON."), { code: "VALIDATION" }); } }
    await configureIntegration(actorOf(user), user.organizationId, str(fd, "kind") as IntegrationKind, { enabled: str(fd, "enabled") === "on", settings });
    return "Saved.";
  }, P);
}

export async function apiKeyAction(_p: KeyState, fd: FormData): Promise<KeyState> {
  const user = await requireUser("/admin/integrations");
  let token = "";
  const state = await runDomain(async () => { const r = await createApiKey(actorOf(user), user.organizationId, { name: str(fd, "name"), scopes: list(fd, "scopes"), expiresAt: opt(fd, "expiresAt") }); token = r.token; return "Key created. Copy it now: it is shown only once."; }, P);
  return { ...state, token };
}
export async function revokeKeyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/integrations");
  return runDomain(async () => { await revokeApiKey(actorOf(user), str(fd, "id")); return "Revoked."; }, P);
}
export async function webhookAction(_p: KeyState, fd: FormData): Promise<KeyState> {
  const user = await requireUser("/admin/integrations");
  let secret = "";
  const state = await runDomain(async () => { const r = await createWebhook(actorOf(user), user.organizationId, { url: str(fd, "url"), events: list(fd, "events") }); secret = r.secret; return "Webhook created. Copy the signing secret now: it is shown only once."; }, P);
  return { ...state, secret };
}
export async function webhookToggleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/integrations");
  return runDomain(async () => { await setWebhookActive(actorOf(user), str(fd, "id"), str(fd, "active") === "1"); return "Updated."; }, P);
}

/** Pastes of CSV (header row) from the HRMS: employeeId,firstName,lastName,department,grade,gender,phone,email,joiningDate,status,lastDay */
export async function hrmsCsvAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/integrations");
  return runDomain(async () => {
    const lines = str(fd, "csv").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw Object.assign(new Error("Paste a header row and at least one record."), { code: "VALIDATION" });
    const head = lines[0].split(",").map((h) => h.trim());
    const records: HrmsRecord[] = lines.slice(1).map((l) => { const c = l.split(",").map((x) => x.trim()); const o: Record<string, string> = {}; head.forEach((h, i) => { o[h] = c[i] ?? ""; }); return { employeeId: o.employeeId, firstName: o.firstName, lastName: o.lastName, department: o.department || null, grade: o.grade || null, gender: (o.gender?.toUpperCase() as HrmsRecord["gender"]) || null, phone: o.phone || null, email: o.email || null, joiningDate: o.joiningDate || null, status: o.status?.toUpperCase() === "EXITED" ? "EXITED" : "ACTIVE", lastDay: o.lastDay || null }; });
    const r = await syncHrms(user.organizationId, records, { actorId: user.id, trigger: "manual" });
    return `Sync finished: ${r.created} created, ${r.updated} updated, ${r.rehired} rehired, ${r.joiners} joiners, ${r.exits} exits, ${r.failed} failed${r.errors[0] ? ` (first error: ${r.errors[0].employeeId}: ${r.errors[0].error})` : ""}.`;
  }, P);
}
