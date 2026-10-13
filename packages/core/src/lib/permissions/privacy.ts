// Personal data is shown at the minimum level each role needs (document section 9).
// ID numbers and HR data are masked everywhere except for the Accommodation Admin and Super Admin.
import type { Role } from "@prisma/client";
import type { ActorLike } from "./actor";
import { actorAccess, actorCan } from "./actor";

export type PersonLevel = "FULL" | "DESK" | "GATE" | "MANAGER" | "NONE";

/** How much of a person's record the actor may see, from the permission matrix (people.view). */
export function personLevel(actor: ActorLike, ctx: { siteId?: string | null } = {}): PersonLevel {
  const a = actorAccess(actor, "people.view", ctx);
  if (!a) return "NONE";
  // A Read-only Manager granted drill-down sees names, never contact or ID details.
  if (a.role === "READONLY_MANAGER") return "MANAGER";
  if (actorCan(actor, "people.view", ctx)) return "FULL"; // SA, AA, or anyone granted full access
  const tag = (a.tag ?? "").toLowerCase();
  if (a.role === "ACCOMMODATION_OFFICER" || tag.includes("masked")) return "DESK";
  if (a.role === "SECURITY" || tag.includes("stay status")) return "GATE";
  return "NONE";
}

export const maskTail = (value: string | null | undefined, keep = 3): string | null => {
  if (!value) return null;
  const v = value.replace(/\s+/g, "");
  return v.length <= keep ? "•".repeat(v.length) : `${"•".repeat(Math.max(3, v.length - keep))}${v.slice(-keep)}`;
};

export type PersonRecord = {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  idType: string | null;
  idNumber: string | null;
  department: string | null;
  grade: string | null;
  company: string | null;
  designation: string | null;
  nationality: string | null;
  eligibilityCategory: string | null;
  entitlement: unknown;
  photoAttachmentId: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
};

export type PersonView = {
  id: string;
  employeeId: string;
  name: string;
  firstName: string;
  hasPhoto: boolean;
  photoAttachmentId: string | null;
  phone: string | null;
  email: string | null;
  idType: string | null;
  idNumber: string | null;
  department: string | null;
  grade: string | null;
  company: string | null;
  designation: string | null;
  nationality: string | null;
  eligibilityCategory: string | null;
  entitlement: unknown;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  /** True when some fields were masked or left out for this viewer. */
  masked: boolean;
};

/** Applies the personal-data visibility table to a staff record for the viewer. */
export function viewPerson(level: PersonLevel, p: PersonRecord): PersonView | null {
  if (level === "NONE") return null;
  const base = { id: p.id, employeeId: p.employeeId, firstName: p.firstName, hasPhoto: !!p.photoAttachmentId, photoAttachmentId: p.photoAttachmentId };
  const none = { phone: null, email: null, idType: null, idNumber: null, department: null, grade: null, company: null, designation: null, nationality: null, eligibilityCategory: null, entitlement: null, emergencyContactName: null, emergencyContactPhone: null };
  switch (level) {
    case "FULL":
      return { ...base, name: `${p.firstName} ${p.lastName}`, phone: p.phone, email: p.email, idType: p.idType, idNumber: p.idNumber, department: p.department, grade: p.grade, company: p.company, designation: p.designation, nationality: p.nationality, eligibilityCategory: p.eligibilityCategory, entitlement: p.entitlement, emergencyContactName: p.emergencyContactName, emergencyContactPhone: p.emergencyContactPhone, masked: false };
    case "DESK":
      // Reception: name, room and dates, masked phone and ID, department only.
      return { ...base, ...none, name: `${p.firstName} ${p.lastName}`, phone: maskTail(p.phone, 3), idType: p.idType, idNumber: maskTail(p.idNumber, 3), department: p.department, masked: true };
    case "GATE":
      // Security: name, photo, stay status; ID type only.
      return { ...base, ...none, name: `${p.firstName} ${p.lastName}`, idType: p.idType, masked: true };
    case "MANAGER":
      return { ...base, ...none, name: `${p.firstName} ${p.lastName}`, masked: true };
    default:
      return { ...base, ...none, name: p.firstName, masked: true };
  }
}

export const canSeeAnyPerson = (actor: ActorLike, roles?: Role[]): boolean => !!roles && actor.roles.some((r) => roles.includes(r));
