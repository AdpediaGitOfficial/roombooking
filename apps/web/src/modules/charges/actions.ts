"use server";

import type { RateKind } from "@prisma/client";
import { actorOf, requireUser } from "@/lib/auth/authorize";
import { runDomain, str, opt, num, type ActionState } from "@/lib/action-state";
import { decideCharge, deactivateRate, raiseCharge, setRate } from "@sam/core/modules/charges/service";

const P = ["/charges", "/my"];
export async function raiseChargeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/charges");
  return runDomain(async () => { await raiseCharge(actorOf(user), { staffId: opt(fd, "staffId"), vendorId: opt(fd, "vendorId"), siteId: opt(fd, "siteId"), kind: (str(fd, "kind") || "OTHER") as RateKind, description: str(fd, "description"), quantity: num(fd, "quantity") ?? 1, amount: num(fd, "amount"), rateCode: opt(fd, "rateCode") }); return "Recorded; waiting for an Admin to approve."; }, P);
}
export async function decideChargeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/charges");
  return runDomain(async () => { await decideCharge(actorOf(user), str(fd, "chargeId"), str(fd, "decision") as "approve" | "reject" | "waive", opt(fd, "note")); return "Decision recorded."; }, P);
}
export async function setRateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/charges/rates");
  return runDomain(async () => { await setRate(actorOf(user), user.organizationId, { kind: str(fd, "kind") as RateKind, code: str(fd, "code"), name: str(fd, "name"), amount: Number(str(fd, "amount")), unit: opt(fd, "unit") ?? undefined, siteId: opt(fd, "siteId") }); return "Rate saved."; }, P);
}
export async function deactivateRateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/charges/rates");
  return runDomain(async () => { await deactivateRate(actorOf(user), str(fd, "rateId")); return "Rate removed."; }, P);
}
