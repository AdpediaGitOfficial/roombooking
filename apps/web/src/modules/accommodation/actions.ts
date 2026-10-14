"use server";

import { revalidatePath } from "next/cache";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth/authorize";
import { ACCOMMODATION_MANAGE_ROLES } from "@sam/core/modules/accommodation/access";

export type ActionState = { error?: string; message?: string };

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "");

/** Runs an API call, turning a client-side refusal into a message and letting real failures surface. */
async function attempt<T>(call: () => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await call() };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    throw error;
  }
}

function refresh(buildingId: string, roomId?: string) {
  if (roomId) revalidatePath(`/accommodation/rooms/${roomId}`);
  revalidatePath(`/accommodation/buildings/${buildingId}`);
  revalidatePath("/accommodation");
}

/** Adds N numbered beds to a room (ACM-01/02). */
export async function addBeds(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(ACCOMMODATION_MANAGE_ROLES);
  const roomId = str(formData, "roomId");
  if (!roomId) return { error: "Room is required." };
  const result = await attempt(() => api.accommodation.addBeds({ roomId, count: Number(formData.get("count") ?? 1) }));
  if ("error" in result) return result;
  refresh(result.ok.buildingId, roomId);
  return { message: result.ok.message };
}

/** Sets a bed to ACTIVE, BLOCKED (with reason) or RETIRED (ACM-09). */
export async function setBedStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(ACCOMMODATION_MANAGE_ROLES);
  const status = str(formData, "status");
  if (status !== "ACTIVE" && status !== "BLOCKED" && status !== "RETIRED") return { error: "Invalid request." };
  const result = await attempt(() => api.accommodation.setBedStatus({ bedId: str(formData, "bedId"), status, reason: str(formData, "reason") }));
  if ("error" in result) return result;
  if (result.ok.changed) refresh(result.ok.buildingId, result.ok.roomId);
  return { message: result.ok.message };
}

/** Sets a whole room to ACTIVE, BLOCKED (with reason) or INACTIVE (ACM-09). */
export async function setRoomStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(ACCOMMODATION_MANAGE_ROLES);
  const roomId = str(formData, "roomId");
  const status = str(formData, "status");
  if (status !== "ACTIVE" && status !== "BLOCKED" && status !== "INACTIVE") return { error: "Invalid request." };
  const result = await attempt(() => api.accommodation.setRoomStatus({ roomId, status, reason: str(formData, "reason") }));
  if ("error" in result) return result;
  refresh(result.ok.buildingId, roomId);
  return { message: result.ok.message };
}
