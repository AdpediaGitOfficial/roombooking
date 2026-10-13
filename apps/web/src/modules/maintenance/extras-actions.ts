"use server";

import { actorOf, requireUser } from "@/lib/auth/authorize";
import { runDomain, str, opt, num, list, type ActionState } from "@/lib/action-state";
import { acceptWorkOrder, addPart, addVendorDocument, addWorker, approveVendor, closePermit, createSchedule, createVendor, decideCost, decidePermit, putOnHold, recordWork, requestPermit, resumeFromHold, scheduleVisit, setRate, setScheduleActive, setWorkerStatus, submitEstimate, suspendVendor, terminateVendor, updateVendor, verifyVendorDocument, verifyWorker, verifyWorkOrder, HOLD_REASONS } from "@sam/core/modules/maintenance/extras";
import type { VendorDocumentKind, WorkOrderPriority } from "@prisma/client";

const P = ["/maintenance", "/my"];
const id = (fd: FormData) => str(fd, "workOrderId");

export async function acceptAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await acceptWorkOrder(actorOf(user), id(fd)); return "Accepted."; }, P);
}
export async function holdAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await putOnHold(actorOf(user), id(fd), str(fd, "reason") as (typeof HOLD_REASONS)[number], opt(fd, "detail")); return "Put on hold."; }, P);
}
export async function resumeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await resumeFromHold(actorOf(user), id(fd)); return "Resumed."; }, P);
}
export async function estimateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await submitEstimate(actorOf(user), id(fd), { amount: Number(str(fd, "amount")), note: opt(fd, "note"), quoteRef: opt(fd, "quoteRef") }); return "Estimate submitted for approval."; }, P);
}
export async function costDecisionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await decideCost(actorOf(user), id(fd), str(fd, "decision") === "approve", opt(fd, "note")); return "Decision recorded."; }, P);
}
export async function verifyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/my");
  return runDomain(async () => { await verifyWorkOrder(actorOf(user), id(fd), { rating: Number(str(fd, "rating")), comment: opt(fd, "comment") }); return "Thank you. The job is verified."; }, P);
}
export async function recordWorkAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await recordWork(actorOf(user), id(fd), { laborHours: num(fd, "laborHours"), rootCause: opt(fd, "rootCause"), costActual: num(fd, "costActual") }); return "Work recorded."; }, P);
}
export async function partAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await addPart(actorOf(user), id(fd), { itemId: opt(fd, "itemId"), name: opt(fd, "name"), quantity: Number(str(fd, "quantity") || 1), unitCost: num(fd, "unitCost") }); return "Part recorded."; }, P);
}
export async function permitRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await requestPermit(actorOf(user), id(fd), { type: str(fd, "type"), hazards: opt(fd, "hazards"), controls: opt(fd, "controls") }); return "Permit requested."; }, P);
}
export async function permitDecisionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await decidePermit(actorOf(user), str(fd, "permitId"), str(fd, "decision") === "approve", { note: opt(fd, "note"), validTo: opt(fd, "validTo") }); return "Decision recorded."; }, P);
}
export async function permitCloseAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await closePermit(actorOf(user), str(fd, "permitId")); return "Permit closed."; }, P);
}
export async function scheduleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await createSchedule(actorOf(user), user.organizationId, { title: str(fd, "title"), category: str(fd, "category"), priority: (str(fd, "priority") || "MEDIUM") as WorkOrderPriority, description: opt(fd, "description"), frequencyDays: Number(str(fd, "frequencyDays")), firstDue: str(fd, "firstDue"), siteId: str(fd, "siteId"), buildingId: opt(fd, "buildingId"), assigneeId: opt(fd, "assigneeId"), vendorId: opt(fd, "vendorId") }); return "Schedule created."; }, P);
}
export async function scheduleToggleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await setScheduleActive(actorOf(user), str(fd, "scheduleId"), str(fd, "active") === "1"); return "Schedule updated."; }, P);
}
export async function vendorCreateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await createVendor(actorOf(user), user.organizationId, { name: str(fd, "name"), contactName: opt(fd, "contactName"), contactPhone: opt(fd, "contactPhone"), contactEmail: opt(fd, "contactEmail"), contractStart: opt(fd, "contractStart"), contractEnd: opt(fd, "contractEnd"), tradeCategories: list(fd, "tradeCategories") }); return "Vendor created."; }, P);
}
export async function vendorUpdateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await updateVendor(actorOf(user), str(fd, "vendorId"), { name: str(fd, "name"), contactName: opt(fd, "contactName"), contactPhone: opt(fd, "contactPhone"), contactEmail: opt(fd, "contactEmail"), contractStart: opt(fd, "contractStart"), contractEnd: opt(fd, "contractEnd") }); return "Vendor saved."; }, P);
}
export async function vendorStateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  const vendorId = str(fd, "vendorId"), to = str(fd, "to"), reason = str(fd, "reason");
  return runDomain(async () => { const a = actorOf(user); if (to === "approve") await approveVendor(a, vendorId); else if (to === "suspend") await suspendVendor(a, vendorId, reason); else await terminateVendor(a, vendorId, reason); return "Vendor updated."; }, P);
}
export async function vendorDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await addVendorDocument(actorOf(user), str(fd, "vendorId"), { kind: str(fd, "kind") as VendorDocumentKind, reference: opt(fd, "reference"), issuedAt: opt(fd, "issuedAt"), expiresAt: opt(fd, "expiresAt") }); return "Document added."; }, P);
}
export async function verifyDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await verifyVendorDocument(actorOf(user), str(fd, "documentId")); return "Document verified."; }, P);
}
export async function rateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await setRate(actorOf(user), str(fd, "vendorId"), { category: str(fd, "category"), unit: opt(fd, "unit") ?? undefined, rate: Number(str(fd, "rate")) }); return "Rate saved."; }, P);
}
export async function workerAddAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await addWorker(actorOf(user), str(fd, "vendorId"), { name: str(fd, "name"), idType: opt(fd, "idType"), idNumber: opt(fd, "idNumber"), phone: opt(fd, "phone"), isSupervisor: str(fd, "isSupervisor") === "on" }); return "Worker added; verification is pending."; }, P);
}
export async function workerVerifyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await verifyWorker(actorOf(user), str(fd, "workerId"), str(fd, "police") === "on"); return "Worker verified."; }, P);
}
export async function workerStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await setWorkerStatus(actorOf(user), str(fd, "workerId"), str(fd, "status") as "SUSPENDED" | "REMOVED"); return "Worker updated."; }, P);
}
export async function visitAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/maintenance");
  return runDomain(async () => { await scheduleVisit(actorOf(user), { workOrderId: opt(fd, "workOrderId"), vendorId: str(fd, "vendorId"), workerIds: list(fd, "workerIds"), start: str(fd, "start"), end: str(fd, "end"), escortRequired: str(fd, "escortRequired") === "on" }); return "Visit scheduled."; }, P);
}
