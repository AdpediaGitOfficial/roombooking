// Eligibility and entitlement (document: People, Allocations).
// A person's grade, department, eligibility category and entitlement are checked against the room's
// (inherited) eligibility before an allocation is made. An Admin with the Eligibility override grant may proceed
// with a reason; every override is flagged in the audit log.
import type { StaffProfileType } from "@prisma/client";

export type RoomEligibility = { grades?: string[]; departments?: string[]; categories?: string[]; profileTypes?: StaffProfileType[] } | null | undefined;
export type Entitlement = { roomTypes?: string[]; maxDays?: number; maxSharing?: number } | null | undefined;

export type EligibilityCheck = { ok: boolean; reasons: string[] };

type StaffLike = { grade?: string | null; department?: string | null; eligibilityCategory?: string | null; profileType?: StaffProfileType; entitlement?: unknown; profileEndDate?: Date | null };
type RoomLike = { type?: string | null };

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function parseRoomEligibility(raw: unknown): RoomEligibility {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return { grades: asList(o.grades), departments: asList(o.departments), categories: asList(o.categories), profileTypes: asList(o.profileTypes) as StaffProfileType[] };
}

export function parseEntitlement(raw: unknown): Entitlement {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return { roomTypes: asList(o.roomTypes), maxDays: typeof o.maxDays === "number" ? o.maxDays : undefined, maxSharing: typeof o.maxSharing === "number" ? o.maxSharing : undefined };
}

const daysBetween = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000);

/** Checks a person against a room's eligibility and their own entitlement for a stay. */
export function checkEligibility(staff: StaffLike, room: RoomLike, roomRule: unknown, stay: { startDate: string; endDate: string | null }): EligibilityCheck {
  const reasons: string[] = [];
  const rule = parseRoomEligibility(roomRule);
  if (rule) {
    if (rule.grades?.length && !(staff.grade && rule.grades.includes(staff.grade))) reasons.push(`This room is for grade ${rule.grades.join(", ")}${staff.grade ? ` (they are ${staff.grade})` : " (no grade on record)"}.`);
    if (rule.departments?.length && !(staff.department && rule.departments.includes(staff.department))) reasons.push(`This room is for ${rule.departments.join(", ")}${staff.department ? ` (they are in ${staff.department})` : ""}.`);
    if (rule.categories?.length && !(staff.eligibilityCategory && rule.categories.includes(staff.eligibilityCategory))) reasons.push(`This room needs eligibility category ${rule.categories.join(" or ")}.`);
    if (rule.profileTypes?.length && staff.profileType && !rule.profileTypes.includes(staff.profileType)) reasons.push(`This room is not open to ${staff.profileType.toLowerCase().replace(/_/g, " ")} profiles.`);
  }
  const ent = parseEntitlement(staff.entitlement);
  if (ent?.roomTypes?.length && room.type && !ent.roomTypes.includes(room.type)) reasons.push(`Their entitlement covers ${ent.roomTypes.join(", ")} rooms, not ${room.type}.`);
  if (ent?.maxDays && stay.endDate && daysBetween(stay.startDate, stay.endDate) > ent.maxDays) reasons.push(`Their entitlement allows stays of up to ${ent.maxDays} days.`);
  if (ent?.maxDays && !stay.endDate && (staff.profileType === "GUEST" || staff.profileType === "TRAINEE")) reasons.push("Guests and trainees need an end date.");
  // Guest and trainee profiles carry a fixed end date: a stay cannot run past it.
  if (staff.profileEndDate) {
    const limit = staff.profileEndDate.toISOString().slice(0, 10);
    if (!stay.endDate) reasons.push(`Their profile ends on ${limit}; set an end date.`);
    else if (stay.endDate > limit) reasons.push(`Their profile ends on ${limit}; the stay cannot go past it.`);
  }
  return { ok: reasons.length === 0, reasons };
}
