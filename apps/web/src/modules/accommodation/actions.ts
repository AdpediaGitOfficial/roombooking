"use server";

import { revalidatePath } from "next/cache";
import type { BedStatus, RoomStatus } from "@prisma/client";
import { prisma } from "@sam/core/lib/db";
import { requireRole } from "@/lib/auth/authorize";
import { guardScope } from "@/lib/auth/guards";
import { recordAudit } from "@sam/core/lib/audit";
import { ACCOMMODATION_MANAGE_ROLES } from "@sam/core/modules/accommodation/access";
import { OCCUPYING_STATUSES } from "@sam/core/modules/accommodation/occupancy";

export type ActionState = { error?: string; message?: string };

const MAX_BEDS_PER_ADD = 20;
const BED_STATUSES: BedStatus[] = ["ACTIVE", "BLOCKED", "RETIRED"];
const ROOM_STATUSES: RoomStatus[] = ["ACTIVE", "BLOCKED", "INACTIVE"];

function nextBedNumber(roomCode: string, existingCodes: string[]): number {
  const prefix = `${roomCode}-`;
  let max = 0;
  for (const code of existingCodes) {
    if (!code.startsWith(prefix)) continue;
    const n = Number(code.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

/** Adds N numbered beds to a room (ACM-01/02). */
export async function addBeds(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(ACCOMMODATION_MANAGE_ROLES);
  await guardScope(user, "accom.view", formData, [["roomId", "room"], ["bedId", "bed"], ["buildingId", "building"]]);
  const roomId = String(formData.get("roomId") ?? "");
  const count = Number(formData.get("count") ?? 1);
  if (!roomId) return { error: "Room is required." };
  if (!Number.isInteger(count) || count < 1 || count > MAX_BEDS_PER_ADD) {
    return { error: `Enter a number of beds between 1 and ${MAX_BEDS_PER_ADD}.` };
  }

  const room = await prisma.room.findUnique({ where: { id: roomId }, include: { beds: { select: { code: true } } } });
  if (!room) return { error: "Room not found." };

  const start = nextBedNumber(room.code, room.beds.map((b) => b.code));
  const codes = Array.from({ length: count }, (_, i) => `${room.code}-${start + i}`);

  await prisma.$transaction(async (tx) => {
    const created = await tx.bed.createManyAndReturn({
      data: codes.map((code) => ({ roomId, code })),
    });
    for (const bed of created) {
      await recordAudit(
        { actorId: user.id, action: "BED_CREATED", entityType: "Bed", entityId: bed.id, after: { roomId, code: bed.code } },
        tx,
      );
    }
  });

  revalidatePath(`/accommodation/rooms/${roomId}`);
  revalidatePath(`/accommodation/buildings/${room.buildingId}`);
  revalidatePath("/accommodation");
  return { message: `Added ${count} bed${count === 1 ? "" : "s"} (${codes[0]}${count > 1 ? ` to ${codes[codes.length - 1]}` : ""}).` };
}

/** Sets a bed to ACTIVE, BLOCKED (with reason) or RETIRED (ACM-09). */
export async function setBedStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(ACCOMMODATION_MANAGE_ROLES);
  await guardScope(user, "accom.view", formData, [["roomId", "room"], ["bedId", "bed"], ["buildingId", "building"]]);
  const bedId = String(formData.get("bedId") ?? "");
  const status = String(formData.get("status") ?? "") as BedStatus;
  const reason = String(formData.get("reason") ?? "").trim();

  if (!bedId || !BED_STATUSES.includes(status)) return { error: "Invalid request." };
  if (status === "BLOCKED" && !reason) return { error: "A reason is required to block a bed." };

  const bed = await prisma.bed.findUnique({
    where: { id: bedId },
    include: { room: true, allocations: { where: { status: { in: OCCUPYING_STATUSES } }, select: { id: true } } },
  });
  if (!bed) return { error: "Bed not found." };
  if (status === "RETIRED" && bed.allocations.length > 0) {
    return { error: "This bed has a current or upcoming allocation. Transfer or check out the occupant before retiring it." };
  }
  if (bed.status === status && (bed.blockReason ?? "") === (status === "BLOCKED" ? reason : "")) {
    return { message: "No change." };
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.bed.update({
      where: { id: bedId },
      data: { status, blockReason: status === "BLOCKED" ? reason : null },
    });
    await recordAudit(
      {
        actorId: user.id,
        action: "BED_STATUS_CHANGED",
        entityType: "Bed",
        entityId: bedId,
        before: { status: bed.status, blockReason: bed.blockReason },
        after: { status: updated.status, blockReason: updated.blockReason, reason: reason || undefined },
      },
      tx,
    );
  });

  revalidatePath(`/accommodation/rooms/${bed.roomId}`);
  revalidatePath(`/accommodation/buildings/${bed.room.buildingId}`);
  revalidatePath("/accommodation");
  const label = status === "ACTIVE" ? "returned to service" : status === "BLOCKED" ? "blocked" : "retired";
  return { message: `Bed ${bed.code} ${label}.${bed.allocations.length > 0 && status === "BLOCKED" ? " It still has an occupant who needs relocating." : ""}` };
}

/** Sets a whole room to ACTIVE, BLOCKED (with reason) or INACTIVE (ACM-09). */
export async function setRoomStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole(ACCOMMODATION_MANAGE_ROLES);
  await guardScope(user, "accom.view", formData, [["roomId", "room"], ["bedId", "bed"], ["buildingId", "building"]]);
  const roomId = String(formData.get("roomId") ?? "");
  const status = String(formData.get("status") ?? "") as RoomStatus;
  const reason = String(formData.get("reason") ?? "").trim();

  if (!roomId || !ROOM_STATUSES.includes(status)) return { error: "Invalid request." };
  if (status !== "ACTIVE" && !reason) return { error: "A reason is required to block or deactivate a room." };

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return { error: "Room not found." };

  await prisma.$transaction(async (tx) => {
    const updated = await tx.room.update({
      where: { id: roomId },
      data: { status, blockReason: status === "ACTIVE" ? null : reason },
    });
    await recordAudit(
      {
        actorId: user.id,
        action: "ROOM_STATUS_CHANGED",
        entityType: "Room",
        entityId: roomId,
        before: { status: room.status, blockReason: room.blockReason },
        after: { status: updated.status, blockReason: updated.blockReason },
      },
      tx,
    );
  });

  revalidatePath(`/accommodation/rooms/${roomId}`);
  revalidatePath(`/accommodation/buildings/${room.buildingId}`);
  revalidatePath("/accommodation");
  return { message: `Room ${room.code} is now ${status.toLowerCase()}.` };
}
