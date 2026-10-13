"use server";

import type { MasterKind, NotificationChannel } from "@prisma/client";
import { actorOf, requireUser } from "@/lib/auth/authorize";
import { runDomain, str, opt, num, type ActionState } from "@/lib/action-state";
import { acknowledgeHouseRule, archiveMaster, publishHouseRule, resetTemplate, restoreMaster, saveMaster, saveTemplate } from "@sam/core/modules/masters/service";

const P = ["/admin"];
export async function masterAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/masters");
  return runDomain(async () => { await saveMaster(actorOf(user), user.organizationId, { id: opt(fd, "id"), kind: str(fd, "kind") as MasterKind, code: str(fd, "code"), name: str(fd, "name"), value: opt(fd, "value"), siteId: opt(fd, "siteId"), sortOrder: num(fd, "sortOrder") ?? 0 }); return "Saved."; }, P);
}
export async function masterArchiveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/masters");
  return runDomain(async () => { await archiveMaster(actorOf(user), str(fd, "id"), str(fd, "reason") || "No longer used"); return "Archived (restorable for 30 days)."; }, P);
}
export async function masterRestoreAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/masters");
  return runDomain(async () => { await restoreMaster(actorOf(user), str(fd, "id")); return "Restored."; }, P);
}
export async function houseRuleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/house-rules");
  return runDomain(async () => { const r = await publishHouseRule(actorOf(user), user.organizationId, { code: str(fd, "code"), title: str(fd, "title"), body: str(fd, "body"), siteId: opt(fd, "siteId") }); return `Published as version ${r.version}. Residents will be asked to acknowledge it.`; }, [...P, "/my"]);
}
export async function acknowledgeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/my/house-rules");
  return runDomain(async () => { await acknowledgeHouseRule(user.id, str(fd, "id")); return "Thank you."; }, ["/my"]);
}
export async function templateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/templates");
  return runDomain(async () => { await saveTemplate(actorOf(user), user.organizationId, { event: str(fd, "event"), channel: str(fd, "channel") as NotificationChannel, enabled: str(fd, "enabled") === "on", subject: opt(fd, "subject"), body: opt(fd, "body") }); return "Saved."; }, P);
}
export async function templateResetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/templates");
  return runDomain(async () => { await resetTemplate(actorOf(user), user.organizationId, str(fd, "event"), str(fd, "channel") as NotificationChannel); return "Back to the default."; }, P);
}
