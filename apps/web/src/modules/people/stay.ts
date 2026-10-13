import { stayStatus, type PersonRow } from "@sam/core/modules/people/service";

/** Resident lifecycle state of a directory row, as of today. */
export function rowStay(r: PersonRow) {
  const today = new Date().toISOString().slice(0, 10);
  return stayStatus(
    {
      verificationStatus: r.verificationStatus,
      archivedAt: r.archivedAt,
      allocations: r.allocations.map((a) => ({ status: a.status, startDate: a.startDate, endDate: a.endDate, provisional: a.provisional })),
      waitlist: r.waitlistEntries,
      exits: r.exitCases.map((e) => ({ status: e.status, lastDay: e.lastDay })),
      joiners: r.joiners,
    },
    today,
  );
}

export const STAY_TONE: Record<string, string> = {
  UNVERIFIED: "chip-warn", ELIGIBLE: "chip-info", WAITLISTED: "chip-info", REQUESTED: "chip-info", RESERVED: "chip-info", PROVISIONAL: "chip-warn",
  CHECKED_IN: "chip-ok", CHECKOUT_DUE: "chip-warn", OVERSTAY: "chip-bad", CHECKED_OUT: "", ARCHIVED: "",
};
