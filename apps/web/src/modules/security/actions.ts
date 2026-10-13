"use server";

import { redirect } from "next/navigation";
import type { IncidentSeverity, IncidentStatus, VisitorKind } from "@prisma/client";
import { actorOf, requireUser } from "@/lib/auth/authorize";
import { runDomain, str, opt, num, type ActionState } from "@/lib/action-state";
import { acknowledgeSos, addRestricted, checkInContractor, checkInVisitor, checkOutContractor, checkOutVisitor, collectParcel, completeRound, confirmWalkIn, decideVisitor, cancelVisitor, issueContractorPass, logParcel, preRegister, raiseSos, registerWalkIn, removeRestricted, reportIncident, resolveSos, savePolicy, scanCheckpoint, startRound, updateIncident } from "@sam/core/modules/security/service";

const P = ["/security", "/my"];

export async function preRegisterAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/my/visitors");
  return runDomain(async () => {
    const v = await preRegister(actorOf(user), { siteId: str(fd, "siteId"), kind: (str(fd, "kind") || "DAY") as Exclude<VisitorKind, "WALK_IN">, name: str(fd, "name"), phone: opt(fd, "phone"), idType: opt(fd, "idType"), idNumber: opt(fd, "idNumber"), company: opt(fd, "company"), purpose: opt(fd, "purpose"), hostStaffId: str(fd, "hostStaffId"), expectedAt: str(fd, "expectedAt"), expectedOutAt: opt(fd, "expectedOutAt"), nights: num(fd, "nights"), restrictedArea: opt(fd, "restrictedArea"), vehicle: opt(fd, "vehicle") });
    return v.status === "APPROVED" ? `Approved. Give your visitor the code ${v.passCode}.` : "Registered. It waits for an Accommodation Admin to approve.";
  }, P);
}
export async function decideVisitorAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security");
  return runDomain(async () => { await decideVisitor(actorOf(user), str(fd, "visitorId"), str(fd, "decision") === "approve", opt(fd, "note")); return "Decision recorded."; }, P);
}
export async function cancelVisitorAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security");
  return runDomain(async () => { await cancelVisitor(actorOf(user), str(fd, "visitorId"), opt(fd, "reason")); return "Cancelled."; }, P);
}
export async function walkInAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security");
  return runDomain(async () => { await registerWalkIn(actorOf(user), { siteId: str(fd, "siteId"), name: str(fd, "name"), hostStaffId: str(fd, "hostStaffId"), phone: opt(fd, "phone"), idType: opt(fd, "idType"), idNumber: opt(fd, "idNumber"), purpose: opt(fd, "purpose"), vehicle: opt(fd, "vehicle") }); return "Logged. The resident has been asked to confirm."; }, P);
}
export async function confirmWalkInAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/my/visitors");
  return runDomain(async () => { await confirmWalkIn(actorOf(user), str(fd, "visitorId"), str(fd, "decision") === "confirm"); return str(fd, "decision") === "confirm" ? "Confirmed. Security will let them in." : "Refused."; }, P);
}
export async function checkInAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security");
  return runDomain(async () => { const r = await checkInVisitor(actorOf(user), str(fd, "visitorId"), { passCode: opt(fd, "passCode") }); return r.lateEntry ? "Checked in (after curfew: logged as a late entry)." : "Checked in."; }, P);
}
export async function checkOutAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security");
  return runDomain(async () => { await checkOutVisitor(actorOf(user), str(fd, "visitorId")); return "Checked out."; }, P);
}
export async function contractorAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security");
  const a = actorOf(user), id = str(fd, "visitId"), op = str(fd, "op");
  return runDomain(async () => {
    if (op === "pass") { const v = await issueContractorPass(a, id); return `Pass issued: ${v.passCode}.`; }
    if (op === "in") { const v = await checkInContractor(a, id); return v.escortRequired ? "Checked in. An escort is required." : "Checked in."; }
    const r = await checkOutContractor(a, id);
    return r.keysStillOut ? `Checked out. ${r.keysStillOut} key(s) are still with this vendor: retrieve them.` : "Checked out.";
  }, P);
}
export async function incidentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security/incidents");
  let id = "";
  const state = await runDomain(async () => { const i = await reportIncident(actorOf(user), { siteId: str(fd, "siteId"), category: str(fd, "category"), severity: (str(fd, "severity") || "MEDIUM") as IncidentSeverity, description: str(fd, "description"), location: opt(fd, "location"), involvedStaffId: opt(fd, "involvedStaffId") }); id = i.id; return "Reported."; }, P);
  if (state.error) return state;
  if (!actorOf(user).roles.some((r) => ["SECURITY", "ACCOMMODATION_ADMIN", "SYSTEM_ADMIN", "ACCOMMODATION_OFFICER"].includes(r))) return state;
  redirect(`/security/incidents/${id}`);
}
export async function incidentUpdateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security/incidents");
  return runDomain(async () => { await updateIncident(actorOf(user), str(fd, "incidentId"), { status: str(fd, "status") as IncidentStatus, note: str(fd, "note"), actionTaken: opt(fd, "actionTaken") }); return "Updated."; }, P);
}
export async function parcelAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security/parcels");
  return runDomain(async () => { await logParcel(actorOf(user), { siteId: str(fd, "siteId"), staffId: opt(fd, "staffId"), recipientName: opt(fd, "recipientName"), carrier: opt(fd, "carrier"), reference: opt(fd, "reference"), notes: opt(fd, "notes") }); return "Parcel logged."; }, P);
}
export async function collectParcelAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security/parcels");
  return runDomain(async () => { await collectParcel(actorOf(user), str(fd, "parcelId"), opt(fd, "name")); return "Handed over."; }, P);
}
export async function sosAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/my");
  return runDomain(async () => { await raiseSos(actorOf(user), { siteId: str(fd, "siteId"), location: opt(fd, "location"), note: opt(fd, "note") }); return "Help is on the way. Security and the accommodation office have been alerted."; }, P);
}
export async function sosRespondAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security/sos");
  const a = actorOf(user), id = str(fd, "sosId");
  return runDomain(async () => { if (str(fd, "op") === "ack") await acknowledgeSos(a, id); else await resolveSos(a, id, str(fd, "note"), str(fd, "op") === "false"); return "Updated."; }, P);
}
export async function patrolAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security/patrol");
  const a = actorOf(user), op = str(fd, "op");
  return runDomain(async () => {
    if (op === "start") { await startRound(a, str(fd, "siteId")); return "Round started."; }
    if (op === "scan") { await scanCheckpoint(a, str(fd, "roundId"), str(fd, "code"), opt(fd, "note")); return "Checkpoint recorded."; }
    const r = await completeRound(a, str(fd, "roundId"), opt(fd, "notes"));
    return r.missed.length ? `Round finished. Missed: ${r.missed.join(", ")}.` : "Round finished. All checkpoints covered.";
  }, P);
}
export async function restrictedAddAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security/restricted");
  return runDomain(async () => { await addRestricted(actorOf(user), { siteId: opt(fd, "siteId"), name: str(fd, "name"), idNumber: opt(fd, "idNumber"), reason: str(fd, "reason") }); return "Added."; }, P);
}
export async function restrictedRemoveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security/restricted");
  return runDomain(async () => (await removeRestricted(actorOf(user), str(fd, "entryId"), str(fd, "note"))) === "removed" ? "Removed." : "Removal requested: a second Admin must approve.", P);
}
export async function policyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/security/policy");
  return runDomain(async () => { await savePolicy(actorOf(user), user.organizationId, str(fd, "siteId"), { dayVisitorsAllowed: str(fd, "dayVisitorsAllowed") === "on", overnightAllowed: str(fd, "overnightAllowed") === "on", requireIdAtGate: str(fd, "requireIdAtGate") === "on", maxNights: num(fd, "maxNights") ?? 3, maxDayHours: num(fd, "maxDayHours") ?? 8, maxActivePerHost: num(fd, "maxActivePerHost") ?? 3, curfewHour: num(fd, "curfewHour") }); return "Policy saved."; }, P);
}
