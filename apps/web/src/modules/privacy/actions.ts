"use server";

import { redirect } from "next/navigation";
import type { DataRequestKind, RetentionAction } from "@prisma/client";
import { actorOf, requireUser, safeReturnPath } from "@/lib/auth/authorize";
import { getCurrentUser } from "@/lib/auth/session";
import { runDomain, str, opt, num, type ActionState } from "@/lib/action-state";
import { acceptConsent, decideDataRequest, executeDataRequest, proposeRetention, submitDataRequest } from "@sam/core/modules/privacy/service";

export async function acceptConsentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await acceptConsent(user.id);
  redirect(safeReturnPath(String(formData.get("next") ?? ""), "/"));
}

export async function dataRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/my/privacy");
  return runDomain(async () => { await submitDataRequest(user.id, str(fd, "kind") as DataRequestKind, opt(fd, "detail")); return "Request sent. You will be notified of the decision."; }, ["/my"]);
}
export async function decideRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/privacy");
  return runDomain(async () => { await decideDataRequest(actorOf(user), str(fd, "id"), str(fd, "decision") === "approve", opt(fd, "note")); return "Decision recorded."; }, ["/admin/privacy"]);
}
export async function executeRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/privacy");
  return runDomain(async () => { await executeDataRequest(actorOf(user), str(fd, "id")); return "Done."; }, ["/admin/privacy"]);
}
export async function retentionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/privacy");
  return runDomain(async () => { const r = await proposeRetention(actorOf(user), user.organizationId, { recordType: str(fd, "recordType"), retainDays: num(fd, "retainDays") ?? 0, action: str(fd, "action") as RetentionAction, active: str(fd, "active") === "on" }); return r.status === "APPLIED" ? "Saved (only one Super Admin exists, so no second approval was needed)." : "Sent to a second Super Admin for approval."; }, ["/admin/privacy"]);
}
