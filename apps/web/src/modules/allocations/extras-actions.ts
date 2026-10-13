"use server";

import { revalidatePath } from "next/cache";
import type { BedReadiness } from "@prisma/client";
import { actorOf, requireUser } from "@/lib/auth/authorize";
import { guardScope } from "@/lib/auth/guards";
import { AllocationError } from "@sam/core/modules/allocations/errors";
import { addToWaitlist, allocateFromWaitlist, bulkAllocate, cancelWaitlist, decideProvisional, emergencyCheckIn, extendStay, setReadiness, swapBeds } from "@sam/core/modules/allocations/extras";

export type ActionState = { error?: string; message?: string; results?: Array<{ name: string; ok: boolean; bed?: string; error?: string }> };

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };

async function run(fn: () => Promise<Partial<ActionState> | string | void>): Promise<ActionState> {
  try {
    const out = await fn();
    revalidatePath("/", "layout");
    if (typeof out === "string") return { message: out };
    return { message: "Saved.", ...(out ?? {}) };
  } catch (error) {
    if (error instanceof AllocationError) return { error: error.message };
    throw error;
  }
}

export async function setReadinessAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/desk");
  await guardScope(user, "accom.view", fd, [["bedId", "bed"], ["roomId", "room"]]);
  return run(async () => {
    const n = await setReadiness(actorOf(user), { bedId: str(fd, "bedId") || undefined, roomId: str(fd, "roomId") || undefined }, str(fd, "readiness") as BedReadiness);
    return `Updated ${n} bed${n === 1 ? "" : "s"}.`;
  });
}

export async function emergencyCheckInAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/desk");
  await guardScope(user, "accom.view", fd, [["bedId", "bed"]]);
  return run(async () => {
    const a = await emergencyCheckIn(actorOf(user), { staffId: str(fd, "staffId"), bedId: str(fd, "bedId"), reason: str(fd, "reason"), endDate: str(fd, "endDate") || null });
    return `Checked in provisionally. An Accommodation Admin must approve it by ${a.provisionalApproveBy?.toISOString().replace("T", " ").slice(0, 16)} UTC.`;
  });
}

export async function decideProvisionalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/desk");
  await guardScope(user, "accom.view", fd, [["allocationId", "allocation"]]);
  const approve = str(fd, "decision") === "approve";
  return run(async () => { await decideProvisional(actorOf(user), str(fd, "allocationId"), approve, str(fd, "note") || null); return approve ? "Approved." : "Rejected: a move task has been created for the desk."; });
}

export async function extendStayAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation/allocations");
  await guardScope(user, "accom.view", fd, [["allocationId", "allocation"]]);
  return run(async () => { await extendStay(actorOf(user), str(fd, "allocationId"), str(fd, "newEndDate"), str(fd, "reason")); return "Stay extended."; });
}

export async function swapBedsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation/allocations");
  await guardScope(user, "accom.view", fd, [["allocationId", "allocation"], ["otherAllocationId", "allocation"]]);
  return run(async () => { await swapBeds(actorOf(user), str(fd, "allocationId"), str(fd, "otherAllocationId"), str(fd, "reason")); return "Beds swapped; both residents have been told."; });
}

export async function bulkAllocateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation/allocations/bulk");
  return run(async () => {
    const r = await bulkAllocate(actorOf(user), { staffIds: fd.getAll("staffIds").filter((x): x is string => typeof x === "string"), startDate: str(fd, "startDate"), endDate: str(fd, "endDate") || null, siteId: str(fd, "siteId") || null, buildingId: str(fd, "buildingId") || null, reason: str(fd, "reason") || null, eligibilityOverrideReason: str(fd, "eligibilityOverrideReason") || null });
    return { message: `Placed ${r.placed} of ${r.results.length}.`, results: r.results.map((x) => ({ name: x.name, ok: x.ok, bed: x.bed, error: x.error })) };
  });
}

export async function addWaitlistAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation/waitlist");
  return run(async () => { await addToWaitlist(actorOf(user), { staffId: str(fd, "staffId"), siteId: str(fd, "siteId") || null, roomType: str(fd, "roomType") || null, neededFrom: str(fd, "neededFrom"), priority: Number(str(fd, "priority") || 0), notes: str(fd, "notes") || null }); return "Added to the waitlist."; });
}

export async function allocateWaitlistAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation/waitlist");
  await guardScope(user, "accom.view", fd, [["bedId", "bed"]]);
  return run(async () => { await allocateFromWaitlist(actorOf(user), str(fd, "entryId"), str(fd, "bedId")); return "Allocated from the waitlist."; });
}

export async function cancelWaitlistAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation/waitlist");
  return run(async () => { await cancelWaitlist(actorOf(user), str(fd, "entryId"), str(fd, "reason")); return "Removed from the waitlist."; });
}
