"use server";

import { redirect } from "next/navigation";
import type { GenderPolicy, StaffProfileType, StayType } from "@prisma/client";
import { actorOf, requireUser } from "@/lib/auth/authorize";
import { runDomain, str, opt, num, list, type ActionState } from "@/lib/action-state";
import { addDependent, addGuestProfile, addStaff, decideDependent, mergeStaff, rehireStaff, setEntitlement, updateStaff, verifyStaff } from "@sam/core/modules/people/service";
import { cancelExit, cancelJoiner, closeClearance, createJoiner, triggerExit } from "@sam/core/modules/people/lifecycle";
import { archiveRecord } from "@sam/core/modules/archive/service";

const PATHS = ["/people"];
const gender = (fd: FormData) => (["ANY", "MALE", "FEMALE"].includes(str(fd, "gender")) ? (str(fd, "gender") as GenderPolicy) : undefined);

function staffFields(fd: FormData) {
  return { firstName: str(fd, "firstName"), lastName: str(fd, "lastName"), phone: opt(fd, "phone"), email: opt(fd, "email"), gender: gender(fd), department: opt(fd, "department"), company: opt(fd, "company"), grade: opt(fd, "grade"), designation: opt(fd, "designation"), idType: opt(fd, "idType"), idNumber: opt(fd, "idNumber"), nationality: opt(fd, "nationality"), joiningDate: opt(fd, "joiningDate") };
}

export async function addStaffAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  let id = "";
  const type = (str(fd, "profileType") || "EMPLOYEE") as StaffProfileType;
  const state = await runDomain(async () => {
    const actor = actorOf(user);
    const staff = type === "GUEST" || type === "TRAINEE" ? await addGuestProfile(actor, user.organizationId, { ...staffFields(fd), profileType: type, profileEndDate: str(fd, "profileEndDate") }) : await addStaff(actor, user.organizationId, { employeeId: str(fd, "employeeId"), ...staffFields(fd), profileType: type, profileEndDate: opt(fd, "profileEndDate") });
    id = staff.id;
  }, PATHS);
  if (state.error) return state;
  redirect(`/people/${id}`);
}

export async function updateStaffAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  return runDomain(async () => { await updateStaff(actorOf(user), str(fd, "staffId"), { ...staffFields(fd), profileEndDate: opt(fd, "profileEndDate") }); return "Profile saved."; }, PATHS);
}

export async function verifyStaffAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  return runDomain(async () => { await verifyStaff(actorOf(user), str(fd, "staffId")); return "Verified."; }, PATHS);
}

export async function entitlementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  return runDomain(async () => { await setEntitlement(actorOf(user), str(fd, "staffId"), { eligibilityCategory: opt(fd, "eligibilityCategory"), roomTypes: list(fd, "roomTypes"), maxDays: num(fd, "maxDays"), maxSharing: num(fd, "maxSharing") }); return "Eligibility saved."; }, PATHS);
}

export async function addDependentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  return runDomain(async () => { await addDependent(actorOf(user), str(fd, "staffId"), { name: str(fd, "name"), relationship: str(fd, "relationship"), dateOfBirth: opt(fd, "dateOfBirth"), idNumber: opt(fd, "idNumber") }); return "Dependent added."; }, PATHS);
}

export async function decideDependentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  return runDomain(async () => { await decideDependent(actorOf(user), str(fd, "dependentId"), str(fd, "decision") === "approve", opt(fd, "note")); return "Decision saved."; }, PATHS);
}

export async function mergeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  return runDomain(async () => { const r = await mergeStaff(actorOf(user), str(fd, "keepId"), str(fd, "mergeId")); return `Merged. Moved ${Object.values(r.moved).reduce((a, b) => a + b, 0)} linked records.`; }, PATHS);
}

export async function rehireAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  return runDomain(async () => { await rehireStaff(actorOf(user), str(fd, "staffId")); return "Reactivated; verify the profile before allocating."; }, PATHS);
}

export async function archiveStaffAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  return runDomain(async () => { await archiveRecord(actorOf(user), "STAFF", str(fd, "staffId"), str(fd, "reason")); return "Archived. It can be restored for 30 days."; }, PATHS);
}

export async function joinerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  return runDomain(async () => { await createJoiner(actorOf(user), { staffId: str(fd, "staffId"), siteId: opt(fd, "siteId"), expectedArrival: str(fd, "expectedArrival"), stayType: (str(fd, "stayType") || "PERMANENT") as StayType, notes: opt(fd, "notes"), endDate: opt(fd, "endDate") }); return "Joiner request raised."; }, PATHS);
}

export async function cancelJoinerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  return runDomain(async () => { await cancelJoiner(actorOf(user), str(fd, "joinerId"), str(fd, "reason")); return "Joiner cancelled."; }, PATHS);
}

export async function exitAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  return runDomain(async () => { await triggerExit(actorOf(user), { staffId: str(fd, "staffId"), lastDay: str(fd, "lastDay"), reason: opt(fd, "reason") }); return "Exit triggered; checkout is now due."; }, PATHS);
}

export async function closeClearanceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  return runDomain(async () => { await closeClearance(actorOf(user), str(fd, "exitId"), opt(fd, "note")); return "Clearance closed."; }, PATHS);
}

export async function cancelExitAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/people");
  return runDomain(async () => { await cancelExit(actorOf(user), str(fd, "exitId"), str(fd, "reason")); return "Exit cancelled."; }, PATHS);
}
