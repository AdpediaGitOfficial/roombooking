// Pure lost-and-found rules, record shapes and labels. No database access, so
// the web app and the API can both import this file.
import type { ClaimOutcome, LostFoundStatus, Prisma } from "@prisma/client";

/** Days an unclaimed item is kept before it is due for disposal (LF-05). */
export const RETENTION_DAYS = Number(process.env.LOST_FOUND_RETENTION_DAYS ?? 90);
export const CATEGORIES = ["Keys", "Phone / electronics", "Wallet / cards / ID", "Clothing", "Bag", "Jewellery / watch", "Documents", "Glasses", "Other"] as const;
export const DISPOSAL_METHODS = ["Donated to charity", "Recycled", "Handed to police", "Destroyed", "Returned to site stock"] as const;

export const itemInclude = {
  site: { select: { id: true, name: true, timezone: true } },
  custodian: { select: { id: true, name: true } },
  registeredBy: { select: { id: true, name: true } },
  handedOverBy: { select: { id: true, name: true } },
  disposalAuthorisedBy: { select: { id: true, name: true } },
  claims: {
    include: { claimant: { select: { id: true, employeeId: true, firstName: true, lastName: true, userId: true } }, claimantUser: { select: { id: true, name: true, email: true } }, decidedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  },
  events: { include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } },
} satisfies Prisma.LostFoundItemInclude;
export type ItemRecord = Prisma.LostFoundItemGetPayload<{ include: typeof itemInclude }>;
export type ClaimRecord = ItemRecord["claims"][number];

export type Actor = { id: string; isOperator: boolean; isManager: boolean };

export function claimantLabel(c: Pick<ClaimRecord, "claimant" | "claimantUser" | "claimantName">): string {
  if (c.claimant) return `${c.claimant.firstName} ${c.claimant.lastName} (${c.claimant.employeeId})`;
  if (c.claimantUser) return c.claimantUser.name;
  return c.claimantName ?? "Unknown claimant";
}

export type ItemFilter = "open" | "reported" | "stored" | "claims" | "due" | "returned" | "disposed" | "all";
export const ITEM_FILTERS: Array<[ItemFilter, string]> = [["open", "Open"], ["reported", "Reported"], ["stored", "Stored"], ["claims", "Claims to verify"], ["due", "Due for disposal"], ["returned", "Returned"], ["disposed", "Disposed"], ["all", "All"]];
export const OPEN: LostFoundStatus[] = ["REPORTED", "STORED", "CLAIM_PENDING"];

export function isDueForDisposal(item: Pick<ItemRecord, "status" | "retainUntil">, now: Date = new Date()): boolean {
  return (item.status === "REPORTED" || item.status === "STORED") && !!item.retainUntil && item.retainUntil <= now;
}

const STOP = new Set(["a", "an", "the", "and", "or", "of", "with", "in", "on", "at", "to", "for", "is", "it", "its", "was", "by", "from"]);
export function keywords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

export function describeStatus(status: LostFoundStatus): string {
  return { REPORTED: "Reported", STORED: "In storage", CLAIM_PENDING: "Claim pending", RETURNED: "Returned to owner", DISPOSED: "Disposed" }[status];
}

export function describeOutcome(outcome: ClaimOutcome): string {
  return { PENDING: "Awaiting verification", VERIFIED: "Verified", REJECTED: "Rejected", WITHDRAWN: "Withdrawn" }[outcome];
}
