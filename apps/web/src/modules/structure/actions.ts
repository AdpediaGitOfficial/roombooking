"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { BuildingType, GenderPolicy } from "@prisma/client";
import { actorOf, requireUser } from "@/lib/auth/authorize";
import { guardScope } from "@/lib/auth/guards";
import { StructureError } from "@sam/core/modules/structure/errors";
import { activateBranch, addBeds, bulkGenerateBuildings, bulkGenerateRooms, createBuilding, createFloor, createRoom, createSite, createUnit, restoreRecord, setStatus, submitForActivation, updateRoom, updateSite, type Level, type LifecycleStatus } from "@sam/core/modules/structure/service";

export type ActionState = { error?: string; message?: string; fieldErrors?: Record<string, string> };

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };
const num = (fd: FormData, k: string) => { const v = str(fd, k); return v === "" ? null : Number(v); };
const gender = (fd: FormData, k: string) => (["ANY", "MALE", "FEMALE"].includes(str(fd, k)) ? (str(fd, k) as GenderPolicy) : undefined);

async function run(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    revalidatePath("/accommodation", "layout");
    return { message: message || "Saved." };
  } catch (error) {
    if (error instanceof StructureError) return { error: error.message, fieldErrors: error.fieldErrors };
    throw error;
  }
}

export async function createSiteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  let id = "";
  const state = await run(async () => {
    const site = await createSite(actorOf(user), user.organizationId, { code: str(fd, "code"), name: str(fd, "name"), propertyType: str(fd, "propertyType") || null, address: str(fd, "address") || null, latitude: num(fd, "latitude"), longitude: num(fd, "longitude"), contactName: str(fd, "contactName") || null, contactPhone: str(fd, "contactPhone") || null, contactEmail: str(fd, "contactEmail") || null, timezone: str(fd, "timezone") || "UTC", genderPolicy: gender(fd, "genderPolicy") ?? null });
    id = site.id;
  });
  if (state.error) return state;
  redirect(`/accommodation/sites/${id}`);
}

export async function updateSiteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  await guardScope(user, "accom.view", fd, []);
  return run(async () => {
    await updateSite(actorOf(user), str(fd, "siteId"), { name: str(fd, "name"), propertyType: str(fd, "propertyType") || null, address: str(fd, "address") || null, latitude: num(fd, "latitude"), longitude: num(fd, "longitude"), contactName: str(fd, "contactName") || null, contactPhone: str(fd, "contactPhone") || null, contactEmail: str(fd, "contactEmail") || null, timezone: str(fd, "timezone") || undefined, genderPolicy: gender(fd, "genderPolicy") ?? null });
    return "Site saved.";
  });
}

export async function createBuildingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  return run(async () => {
    const b = await createBuilding(actorOf(user), str(fd, "siteId"), { code: str(fd, "code"), name: str(fd, "name"), type: (str(fd, "type") || "BUILDING") as BuildingType, address: str(fd, "address") || null, genderPolicy: gender(fd, "genderPolicy") ?? null });
    return `Building ${b.name} created as a draft.`;
  });
}

export async function bulkBuildingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  return run(async () => {
    const r = await bulkGenerateBuildings(actorOf(user), str(fd, "siteId"), { prefix: str(fd, "prefix") || "B", from: Number(str(fd, "from") || 1), to: Number(str(fd, "to") || 1), pad: Number(str(fd, "pad") || 2), namePrefix: str(fd, "namePrefix") || undefined, type: (str(fd, "type") || "BUILDING") as BuildingType });
    return `Created ${r.created} building${r.created === 1 ? "" : "s"} as drafts${r.skipped ? `; skipped ${r.skipped} that already exist` : ""}.`;
  });
}

export async function createFloorAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  return run(async () => { await createFloor(actorOf(user), str(fd, "buildingId"), { code: str(fd, "code"), name: str(fd, "name") || null, level: Number(str(fd, "level") || 0) }); return "Floor added."; });
}

export async function createUnitAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  return run(async () => { await createUnit(actorOf(user), str(fd, "buildingId"), { code: str(fd, "code"), name: str(fd, "name") || null, floorId: str(fd, "floorId") || null }); return "Unit added."; });
}

function roomFields(fd: FormData) {
  return {
    type: str(fd, "type") || null,
    floorId: str(fd, "floorId") || null,
    unitId: str(fd, "unitId") || null,
    genderPolicy: gender(fd, "genderPolicy"),
    inheritsPolicy: fd.get("inheritsPolicy") === "on",
    amenities: str(fd, "amenities").split(",").map((x) => x.trim()).filter(Boolean),
    attachedBath: fd.get("attachedBath") === "on",
    areaSqm: num(fd, "areaSqm"),
    monthlyCharge: num(fd, "monthlyCharge"),
  };
}

export async function createRoomAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  return run(async () => { const r = await createRoom(actorOf(user), str(fd, "buildingId"), { code: str(fd, "code"), ...roomFields(fd), bedCount: Number(str(fd, "bedCount") || 0), bedType: str(fd, "bedType") || null }); return `Room ${r.code} created as a draft.`; });
}

export async function bulkRoomsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  return run(async () => {
    const r = await bulkGenerateRooms(actorOf(user), str(fd, "buildingId"), { prefix: str(fd, "prefix"), from: Number(str(fd, "from") || 1), to: Number(str(fd, "to") || 1), pad: Number(str(fd, "pad") || 0), ...roomFields(fd), bedCount: Number(str(fd, "bedCount") || 0), bedType: str(fd, "bedType") || null });
    return `Created ${r.created} room${r.created === 1 ? "" : "s"} with beds as drafts${r.skipped ? `; skipped ${r.skipped} that already exist` : ""}.`;
  });
}

export async function updateRoomAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  await guardScope(user, "accom.view", fd, [["roomId", "room"]]);
  return run(async () => { await updateRoom(actorOf(user), str(fd, "roomId"), roomFields(fd)); return "Room saved."; });
}

export async function addBedsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  await guardScope(user, "accom.view", fd, [["roomId", "room"]]);
  return run(async () => { const beds = await addBeds(actorOf(user), str(fd, "roomId"), Number(str(fd, "count") || 1), str(fd, "bedType") || null); return `Added ${beds.length} bed${beds.length === 1 ? "" : "s"} (${beds[0].code}${beds.length > 1 ? ` to ${beds[beds.length - 1].code}` : ""}).`; });
}

export async function statusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  const level = str(fd, "level") as Level;
  if (level === "BUILDING") await guardScope(user, "accom.view", fd, [["id", "building"]]);
  else if (level === "ROOM") await guardScope(user, "accom.view", fd, [["id", "room"]]);
  else if (level === "BED") await guardScope(user, "accom.view", fd, [["id", "bed"]]);
  return run(async () => {
    const r = await setStatus(actorOf(user), { level, id: str(fd, "id"), status: str(fd, "status") as LifecycleStatus, reason: str(fd, "reason") || null, until: str(fd, "until") || null });
    return `Now ${r.to.toLowerCase()}.`;
  });
}

export async function activateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  return run(async () => { const r = await activateBranch(actorOf(user), str(fd, "level") as "SITE" | "BUILDING", str(fd, "id")); return `Activated ${r.buildings} building${r.buildings === 1 ? "" : "s"}, ${r.rooms} room${r.rooms === 1 ? "" : "s"} and ${r.beds} bed${r.beds === 1 ? "" : "s"}: they now appear in Allocations.`; });
}

export async function submitActivationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  return run(async () => { const r = await submitForActivation(actorOf(user), user.organizationId, str(fd, "level") as "SITE" | "BUILDING", str(fd, "id")); return `Submitted. ${r.notified} Super Admin${r.notified === 1 ? " has" : "s have"} been asked to activate it.`; });
}

export async function restoreAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/accommodation");
  return run(async () => { await restoreRecord(actorOf(user), str(fd, "level") as Level, str(fd, "id")); return "Restored as a draft. Activate it to bring it back into service."; });
}
