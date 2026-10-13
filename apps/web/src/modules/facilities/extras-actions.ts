"use server";

import { actorOf, requireUser } from "@/lib/auth/authorize";
import { runDomain, str, opt, num, list, type ActionState } from "@/lib/action-state";
import { acceptWaitlistOffer, blockSlots, cancelWaitlist, closeFacility, joinWaitlist, liftNoShowBlock, removeBlock, reopenFacility, updateFacilityPolicy } from "@sam/core/modules/facilities/extras";

const P = ["/facilities", "/my"];
export async function closeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/facilities");
  return runDomain(async () => { const r = await closeFacility(actorOf(user), { facilityId: str(fd, "facilityId"), startsAt: str(fd, "startsAt"), endsAt: str(fd, "endsAt"), reason: str(fd, "reason") }); return `Closed. ${r.cancelled} booking(s) cancelled and the people told.`; }, P);
}
export async function reopenAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/facilities");
  return runDomain(async () => { await reopenFacility(actorOf(user), str(fd, "id")); return "Reopened."; }, P);
}
export async function blockAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/facilities");
  return runDomain(async () => {
    const r = await blockSlots(actorOf(user), { facilityId: str(fd, "facilityId"), type: (str(fd, "type") || "BLOCK") as "BLOCK" | "EVENT" | "RECURRING", title: str(fd, "title"), startsAt: opt(fd, "startsAt") ?? undefined, endsAt: opt(fd, "endsAt") ?? undefined, weekdays: list(fd, "weekdays").map(Number), from: opt(fd, "from") ?? undefined, to: opt(fd, "to") ?? undefined, until: opt(fd, "until") ?? undefined });
    return `Blocked. ${r.cancelled} booking(s) cancelled.`;
  }, P);
}
export async function removeBlockAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/facilities");
  return runDomain(async () => { await removeBlock(actorOf(user), str(fd, "id")); return "Removed."; }, P);
}
export async function liftAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/facilities");
  return runDomain(async () => { const n = await liftNoShowBlock(actorOf(user), str(fd, "userId"), opt(fd, "facilityId")); return `Lifted (${n} strike(s) cleared).`; }, P);
}
export async function policyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/facilities");
  const split = (k: string) => str(fd, k).split(",").map((x) => x.trim()).filter(Boolean);
  return runDomain(async () => { await updateFacilityPolicy(actorOf(user), str(fd, "facilityId"), { grades: split("grades"), departments: split("departments"), categories: split("categories"), feePerHour: num(fd, "feePerHour"), noShowLimit: num(fd, "noShowLimit") }); return "Saved."; }, P);
}
export async function joinWaitlistAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/my/facilities");
  return runDomain(async () => { await joinWaitlist(user.id, { facilityId: str(fd, "facilityId"), date: str(fd, "date"), startTime: str(fd, "startTime"), durationMinutes: num(fd, "durationMinutes") ?? 60, headcount: num(fd, "headcount") ?? 1 }); return "You are on the waitlist. If a place frees up you will be offered it for two hours."; }, P);
}
export async function acceptOfferAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/my/facilities");
  return runDomain(async () => { await acceptWaitlistOffer(user.id, str(fd, "id")); return "Booked."; }, P);
}
export async function leaveWaitlistAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/my/facilities");
  return runDomain(async () => { await cancelWaitlist(user.id, str(fd, "id")); return "Removed."; }, P);
}
