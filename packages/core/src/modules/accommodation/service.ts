// Accommodation hierarchy changes: beds and room/bed availability (ACM-01/02/09).
// Reads live in occupancy.ts; this file holds the audited writes.
import type { BedStatus, RoomStatus } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { AccommodationError } from "./errors";
import { OCCUPYING_STATUSES } from "./occupancy-rules";

export const MAX_BEDS_PER_ADD = 20;
export type SettableBedStatus = Extract<BedStatus, "ACTIVE" | "BLOCKED" | "RETIRED">;
export type SettableRoomStatus = Extract<RoomStatus, "ACTIVE" | "BLOCKED" | "INACTIVE">;

export function nextBedNumber(roomCode: string, existingCodes: string[]): number {
  const prefix = `${roomCode}-`;
  let max = 0;
  for (const code of existingCodes) {
    if (!code.startsWith(prefix)) continue;
    const n = Number(code.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

/** Adds N numbered beds to a room. */
export async function addBeds(input: { actorId: string; roomId: string; count: number }) {
  const { actorId, roomId, count } = input;
  if (!Number.isInteger(count) || count < 1 || count > MAX_BEDS_PER_ADD) {
    throw new AccommodationError("VALIDATION", `Enter a number of beds between 1 and ${MAX_BEDS_PER_ADD}.`, { count: "Out of range." });
  }
  const room = await prisma.room.findUnique({ where: { id: roomId }, include: { beds: { select: { code: true } } } });
  if (!room) throw new AccommodationError("NOT_FOUND", "Room not found.");

  const start = nextBedNumber(room.code, room.beds.map((b) => b.code));
  const codes = Array.from({ length: count }, (_, i) => `${room.code}-${start + i}`);

  await prisma.$transaction(async (tx) => {
    const created = await tx.bed.createManyAndReturn({ data: codes.map((code) => ({ roomId, code })) });
    for (const bed of created) {
      await recordAudit({ actorId, action: "BED_CREATED", entityType: "Bed", entityId: bed.id, after: { roomId, code: bed.code } }, tx);
    }
  });

  return {
    buildingId: room.buildingId,
    codes,
    message: `Added ${count} bed${count === 1 ? "" : "s"} (${codes[0]}${count > 1 ? ` to ${codes[codes.length - 1]}` : ""}).`,
  };
}

/** Sets a bed to ACTIVE, BLOCKED (with reason) or RETIRED. */
export async function setBedStatus(input: { actorId: string; bedId: string; status: SettableBedStatus; reason?: string }) {
  const { actorId, bedId, status } = input;
  const reason = (input.reason ?? "").trim();
  if (status === "BLOCKED" && !reason) throw new AccommodationError("VALIDATION", "A reason is required to block a bed.", { reason: "Required." });

  const bed = await prisma.bed.findUnique({
    where: { id: bedId },
    include: { room: true, allocations: { where: { status: { in: OCCUPYING_STATUSES } }, select: { id: true } } },
  });
  if (!bed) throw new AccommodationError("NOT_FOUND", "Bed not found.");
  if (status === "RETIRED" && bed.allocations.length > 0) {
    throw new AccommodationError("INVALID_STATE", "This bed has a current or upcoming allocation. Transfer or check out the occupant before retiring it.");
  }
  const base = { roomId: bed.roomId, buildingId: bed.room.buildingId };
  if (bed.status === status && (bed.blockReason ?? "") === (status === "BLOCKED" ? reason : "")) {
    return { ...base, changed: false, message: "No change." };
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.bed.update({ where: { id: bedId }, data: { status, blockReason: status === "BLOCKED" ? reason : null } });
    await recordAudit(
      {
        actorId,
        action: "BED_STATUS_CHANGED",
        entityType: "Bed",
        entityId: bedId,
        before: { status: bed.status, blockReason: bed.blockReason },
        after: { status: updated.status, blockReason: updated.blockReason, reason: reason || undefined },
      },
      tx,
    );
  });

  const label = status === "ACTIVE" ? "returned to service" : status === "BLOCKED" ? "blocked" : "retired";
  return { ...base, changed: true, message: `Bed ${bed.code} ${label}.${bed.allocations.length > 0 && status === "BLOCKED" ? " It still has an occupant who needs relocating." : ""}` };
}

/** Sets a whole room to ACTIVE, BLOCKED (with reason) or INACTIVE. */
export async function setRoomStatus(input: { actorId: string; roomId: string; status: SettableRoomStatus; reason?: string }) {
  const { actorId, roomId, status } = input;
  const reason = (input.reason ?? "").trim();
  if (status !== "ACTIVE" && !reason) throw new AccommodationError("VALIDATION", "A reason is required to block or deactivate a room.", { reason: "Required." });

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new AccommodationError("NOT_FOUND", "Room not found.");

  await prisma.$transaction(async (tx) => {
    const updated = await tx.room.update({ where: { id: roomId }, data: { status, blockReason: status === "ACTIVE" ? null : reason } });
    await recordAudit(
      {
        actorId,
        action: "ROOM_STATUS_CHANGED",
        entityType: "Room",
        entityId: roomId,
        before: { status: room.status, blockReason: room.blockReason },
        after: { status: updated.status, blockReason: updated.blockReason },
      },
      tx,
    );
  });

  return { buildingId: room.buildingId, message: `Room ${room.code} is now ${status.toLowerCase()}.` };
}
