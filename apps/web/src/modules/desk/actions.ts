"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/authorize";
import { ShiftError, endShift, startShift } from "@sam/core/modules/desk/service";

export type ActionState = { error?: string; message?: string };

async function run(fn: () => Promise<string>): Promise<ActionState> {
  try { const message = await fn(); revalidatePath("/desk", "layout"); return { message }; } catch (e) { if (e instanceof ShiftError) return { error: e.message }; throw e; }
}

export async function startShiftAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/desk");
  const role = user.roleAssignments.find((r) => r.role === "SECURITY" || r.role === "ACCOMMODATION_OFFICER" || r.role === "ACCOMMODATION_ADMIN")?.role ?? user.roleAssignments[0]?.role;
  return run(async () => { await startShift({ userId: user.id, role: role!, siteId: String(fd.get("siteId") ?? "") || null }); return "Shift started."; });
}

export async function endShiftAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/desk");
  return run(async () => { await endShift({ userId: user.id, notes: String(fd.get("notes") ?? "") }); return "Shift ended and logged."; });
}
