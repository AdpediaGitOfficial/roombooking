// The scheduled jobs in one place: outbox delivery and the booking and request sweeps.
// Called by the worker on its timer and by the API's job endpoint for external schedulers.
import { sweepBookings } from "../facilities/service";
import { processOutbox } from "../notifications/worker";
import { sweepRequests } from "../requests/service";

export async function runScheduledJobs(opts: { limit?: number } = {}) {
  const result = await processOutbox({ limit: opts.limit ?? 50 });
  const bookings = await sweepBookings();
  const requests = await sweepRequests();
  return { ...result, bookings, requests };
}
