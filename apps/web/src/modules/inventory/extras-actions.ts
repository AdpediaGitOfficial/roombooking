"use server";

import { actorOf, requireUser } from "@/lib/auth/authorize";
import { runDomain, str, opt, num, type ActionState } from "@/lib/action-state";
import { decideWriteOff, moveToStore, requestWriteOff } from "@sam/core/modules/inventory/extras";

const P = ["/inventory"];
export async function writeOffRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/inventory");
  return runDomain(async () => { const w = await requestWriteOff(actorOf(user), { itemId: str(fd, "itemId"), quantity: num(fd, "quantity") ?? 1, reason: str(fd, "reason") }); return w.needsSuperAdmin ? "Write-off requested. It is above the limit, so a Super Admin must approve it." : "Write-off requested for Admin approval."; }, P);
}
export async function writeOffDecisionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/inventory");
  return runDomain(async () => { await decideWriteOff(actorOf(user), str(fd, "writeOffId"), str(fd, "decision") === "approve", opt(fd, "note")); return "Decision recorded."; }, P);
}
export async function storeMoveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/inventory");
  return runDomain(async () => { await moveToStore(actorOf(user), str(fd, "itemId"), str(fd, "store"), opt(fd, "notes")); return "Moved."; }, P);
}
