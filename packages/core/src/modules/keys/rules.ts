// Pure key rules and labels. No database access, so the web app and the API can both import this file.
import type { KeyStatus, Prisma } from "@prisma/client";

export const keyInclude = {
  site: true,
  room: { include: { building: true } },
  facility: true,
  replaces: { select: { id: true, code: true } },
  replacedBy: { select: { id: true, code: true } },
  transactions: {
    include: { holder: { select: { id: true, employeeId: true, firstName: true, lastName: true, userId: true } }, custodian: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.KeyInclude;

/** For register lists: just the place, the key and its open issue, not the whole history or full site records. */
export const keyListInclude = {
  site: { select: { id: true, code: true, name: true } },
  room: { select: { id: true, code: true, building: { select: { id: true, name: true } } } },
  facility: { select: { id: true, name: true } },
  transactions: { ...keyInclude.transactions, where: { type: "ISSUE", returnedAt: null } },
} satisfies Prisma.KeyInclude;

export type KeyRecord = Prisma.KeyGetPayload<{ include: typeof keyInclude }>;
export type KeyTransactionRecord = KeyRecord["transactions"][number];

export const CONDITIONS = ["Good", "Worn", "Damaged"] as const;

export function openIssue(key: Pick<KeyRecord, "transactions">): KeyTransactionRecord | null {
  return key.transactions.find((t) => t.type === "ISSUE" && t.returnedAt === null) ?? null;
}

export function holderLabel(t: Pick<KeyTransactionRecord, "holder" | "holderName">): string {
  return t.holder ? `${t.holder.firstName} ${t.holder.lastName} (${t.holder.employeeId})` : (t.holderName ?? "Unknown holder");
}

export function isOverdue(t: Pick<KeyTransactionRecord, "expectedReturnAt" | "returnedAt">, now: Date = new Date()): boolean {
  return t.returnedAt === null && !!t.expectedReturnAt && t.expectedReturnAt < now;
}

export type KeyFilter = "all" | "available" | "issued" | "overdue" | "exceptions" | "retired";

export function describeKeyStatus(status: KeyStatus): string {
  return { AVAILABLE: "Available", ISSUED: "Issued", LOST: "Lost", DAMAGED: "Damaged", UNDER_REPAIR: "Under repair", RETIRED: "Retired" }[status];
}

export function keyLocation(key: { room: { code: string; building: { name: string } } | null; facility: { name: string } | null; site: { name: string } }): string {
  if (key.room) return `${key.room.building.name} · Room ${key.room.code}`;
  if (key.facility) return `Facility · ${key.facility.name}`;
  return key.site.name;
}
