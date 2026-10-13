"use server";

import { redirect } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { actorOf, requireUser } from "@/lib/auth/authorize";
import { runDomain, str, opt, num, type ActionState } from "@/lib/action-state";
import { assignTask, completeTask, createAdhocTask, performInspection, scheduleInspections, setInspectionScheduleActive, startTask } from "@sam/core/modules/housekeeping/service";

const P = ["/housekeeping", "/desk"];
export async function taskAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/housekeeping");
  const a = actorOf(user), id = str(fd, "taskId"), op = str(fd, "op");
  return runDomain(async () => {
    if (op === "start") { await startTask(a, id); return "Started."; }
    if (op === "done") { await completeTask(a, id, opt(fd, "notes")); return "Done: the bed is marked ready."; }
    await assignTask(a, id, opt(fd, "assigneeId")); return "Assigned.";
  }, P);
}
export async function adhocTaskAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/housekeeping");
  return runDomain(async () => {
    const room = await prisma.room.findUnique({ where: { id: str(fd, "roomId") }, include: { building: true } });
    await createAdhocTask(actorOf(user), { siteId: room?.building.siteId ?? "", roomId: str(fd, "roomId"), notes: opt(fd, "notes") });
    return "Task created.";
  }, P);
}
export async function scheduleInspectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/housekeeping/inspections");
  return runDomain(async () => { await scheduleInspections(actorOf(user), { siteId: str(fd, "siteId"), buildingId: opt(fd, "buildingId"), title: str(fd, "title"), frequencyDays: num(fd, "frequencyDays") ?? 0, firstDue: str(fd, "firstDue") }); return "Scheduled."; }, P);
}
export async function toggleInspectionScheduleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/housekeeping/inspections");
  return runDomain(async () => { await setInspectionScheduleActive(actorOf(user), str(fd, "scheduleId"), str(fd, "active") === "1"); return "Updated."; }, P);
}
export async function performInspectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/housekeeping/inspections");
  const ids = fd.getAll("item").map(String);
  const results = ids.map((id) => ({ id, ok: str(fd, `ok:${id}`) === "ok", note: opt(fd, `note:${id}`) }));
  const state = await runDomain(async () => { const r = await performInspection(actorOf(user), str(fd, "inspectionId"), results, opt(fd, "notes")); return r.workOrderIds.length ? `Done. ${r.workOrderIds.length} work order(s) raised for the issues.` : "Done: no issues."; }, P);
  if (state.error) return state;
  redirect("/housekeeping/inspections");
}
