"use server";

import { actorOf, requireUser } from "@/lib/auth/authorize";
import { runDomain, str, opt, num, list, type ActionState } from "@/lib/action-state";
import { bulkCreateKeys, completeKeyAudit, completeLoss, decideLoss, startKeyAudit } from "@sam/core/modules/keys/extras";

const P = ["/keys"];
export async function lossDecisionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/keys");
  return runDomain(async () => { await decideLoss(actorOf(user), str(fd, "caseId"), str(fd, "decision") === "approve", opt(fd, "note")); return str(fd, "decision") === "approve" ? "Approved; a lock-change work order was raised." : "Rejected."; }, P);
}
export async function lossCompleteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/keys");
  return runDomain(async () => { await completeLoss(actorOf(user), str(fd, "caseId"), str(fd, "newCode")); return "Replacement key registered; case closed."; }, P);
}
export async function auditStartAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/keys");
  return runDomain(async () => { await startKeyAudit(actorOf(user), str(fd, "siteId")); return "Audit started. Count the keys in the cabinet and enter their codes."; }, P);
}
export async function auditCompleteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/keys");
  return runDomain(async () => {
    const codes = str(fd, "codes").split(/[\s,;]+/).filter(Boolean);
    const a = await completeKeyAudit(actorOf(user), str(fd, "auditId"), codes);
    const v = a.variances as { missing: string[]; unexpected: unknown[] };
    return `Audit complete: ${v.missing.length} missing, ${v.unexpected.length} unexpected.`;
  }, P);
}
export async function bulkKeysAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/keys");
  return runDomain(async () => { const r = await bulkCreateKeys(actorOf(user), { siteId: str(fd, "siteId"), buildingId: opt(fd, "buildingId"), copies: num(fd, "copies") ?? 1, prefix: opt(fd, "prefix") }); return `Created ${r.created} key${r.created === 1 ? "" : "s"} for ${r.rooms} rooms${r.skipped ? ` (${r.skipped} already existed)` : ""}.`; }, P);
}
void list;
