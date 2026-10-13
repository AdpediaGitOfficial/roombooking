"use server";

import type { AlertComparison, ScheduleFrequency } from "@prisma/client";
import { actorOf, requireUser } from "@/lib/auth/authorize";
import { runDomain, str, opt, num, type ActionState } from "@/lib/action-state";
import { createAlert, createSubscription, removeAlert, removeSubscription } from "@sam/core/modules/reports/schedule";
import { setTarget, updateDefinition } from "@sam/core/modules/kpi/service";

const P = ["/reports"];
export async function subscribeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/reports/scheduled");
  return runDomain(async () => { await createSubscription(actorOf(user), { report: str(fd, "report"), frequency: (str(fd, "frequency") || "WEEKLY") as ScheduleFrequency }); return "Scheduled. You will get it as a notification and an email."; }, P);
}
export async function unsubscribeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/reports/scheduled");
  return runDomain(async () => { await removeSubscription(actorOf(user), str(fd, "id")); return "Removed."; }, P);
}
export async function alertAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/reports/scheduled");
  return runDomain(async () => { await createAlert(actorOf(user), { kpiKey: str(fd, "kpiKey"), comparison: str(fd, "comparison") as AlertComparison, threshold: Number(str(fd, "threshold")), siteId: opt(fd, "siteId") }); return "Alert set."; }, P);
}
export async function removeAlertAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/reports/scheduled");
  return runDomain(async () => { await removeAlert(actorOf(user), str(fd, "id")); return "Removed."; }, P);
}
export async function targetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/reports/dictionary");
  return runDomain(async () => { await setTarget(actorOf(user), user.organizationId, str(fd, "key"), opt(fd, "siteId"), num(fd, "target")); return "Target saved."; }, P);
}
export async function definitionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/reports/dictionary");
  return runDomain(async () => { await updateDefinition(actorOf(user), user.organizationId, str(fd, "key"), { formula: opt(fd, "formula") ?? undefined, owner: opt(fd, "owner") ?? undefined, source: opt(fd, "source") ?? undefined }); return "Definition saved."; }, P);
}
