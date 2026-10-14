// Pure helpers for the resident portal; safe to import from any layer.

/** Human-readable text for an outbox event. */
export function describeNotification(event: string, payload: unknown): { title: string; body: string } {
  const p = (payload ?? {}) as Record<string, string | null | undefined>;
  switch (event) {
    case "allocation.confirmed":
      return { title: "Accommodation confirmed", body: `Bed ${p.bed} in ${p.building}, room ${p.room}, from ${p.startDate}${p.endDate ? ` to ${p.endDate}` : ""}.` };
    case "allocation.checked_out":
      return { title: "Checked out", body: `Your stay in bed ${p.bed} ended on ${p.endDate}.` };
    case "booking.confirmed":
      return { title: "Booking confirmed", body: `${p.facility} on ${p.date}, ${p.startTime}–${p.endTime}.` };
    case "booking.pending":
      return { title: "Booking awaiting approval", body: `${p.facility} on ${p.date} at ${p.startTime}.` };
    case "booking.rejected":
      return { title: "Booking declined", body: `${p.facility} on ${p.date} at ${p.startTime}${p.reason ? `: ${p.reason}` : "."}` };
    case "booking.cancelled":
      return { title: "Booking cancelled", body: `${p.facility} on ${p.date} at ${p.startTime}${p.reason ? `: ${p.reason}` : "."}` };
    case "request.reminder":
      return { title: "Approval waiting", body: `${p.type} at "${p.step}" for ${p.days} day(s).` };
    case "request.escalated":
      return { title: "Request escalated to you", body: `${p.type} at "${p.step}" after ${p.days} day(s).` };
    case "request.escalated_requester":
      return { title: "Request escalated", body: `Your ${p.type} has been escalated to a senior approver.` };
    case "request.reassigned":
      return { title: "Approval step reassigned to you", body: `${p.type} · ${p.step}${p.reason ? `: ${p.reason}` : ""}` };
    case "request.expired":
      return { title: "Request expired", body: `Your ${p.type} was not decided in time. You can resubmit it.` };
    case "delegation.started":
      return { title: "You are covering approvals", body: `For ${p.delegator}, ${p.startsAt} to ${p.endsAt}.` };
    case "delegation.arranged":
      return { title: "Approval cover arranged", body: `${p.delegate} covers your approvals ${p.startsAt} to ${p.endsAt}.` };
    case "delegation.ended":
      return { title: "Approval cover ended", body: `You no longer cover for ${p.delegator}.` };
    case "broadcast":
      return { title: p.title ?? "Announcement", body: (p.body ?? "").length > 160 ? `${(p.body ?? "").slice(0, 157)}…` : p.body ?? "" };
    case "lostfound.claim_verified":
      return { title: "Lost and found claim verified", body: `${p.reference}: ${p.description}. Collect it from the accommodation office${p.storageLocation ? ` (${p.storageLocation})` : ""} with your ID.` };
    case "lostfound.claim_rejected":
      return { title: "Lost and found claim not verified", body: `${p.reference}${p.reason ? `: ${p.reason}` : "."}` };
    case "lostfound.returned":
      return { title: "Found item handed over", body: `${p.reference}: ${p.description}.` };
    case "allocation.cancelled":
      return { title: "Allocation cancelled", body: `Bed ${p.bed} is no longer allocated to you${p.reason ? `: ${p.reason}` : "."}` };
    default:
      return { title: event.replace(/[._]/g, " "), body: "" };
  }
}
