// Scheduled sweeps that keep lifecycle state moving (document sections 8 and 9). Each sweep is independent: one
// failing never stops the others. The worker runs this about hourly; every sweep is idempotent.
import { sweepProvisional } from "../allocations/extras";
import { sweepExpiredProfiles } from "../people/service";
import { sweepExits, sweepJoiners } from "../people/lifecycle";
import { runPreventive, sweepVendors, sweepWorkOrders } from "../maintenance/extras";
import { sweepBookings } from "../facilities/service";
import { sweepRequests } from "../requests/service";
import { sweepVisitors } from "../security/service";
import { runInspectionSchedules } from "../housekeeping/service";

export type SweepResult = Record<string, unknown>;
const SWEEPS: Array<[string, (now: Date) => Promise<unknown>]> = [
  ["provisionalCheckIns", (now) => sweepProvisional(now)],
  ["expiredProfiles", (now) => sweepExpiredProfiles(now)],
  ["joiners", () => sweepJoiners()],
  ["exits", (now) => sweepExits(now)],
  ["workOrdersAutoClosed", (now) => sweepWorkOrders(now)],
  ["preventiveRaised", (now) => runPreventive(now)],
  ["vendors", (now) => sweepVendors(now)],
  ["visitors", (now) => sweepVisitors(now)],
  ["inspectionsScheduled", (now) => runInspectionSchedules(now)],
  ["bookings", () => sweepBookings()],
  ["requests", () => sweepRequests()],
];

/** Extra sweeps registered by later modules (security, housekeeping, charges, reports). */
const extra: Array<[string, (now: Date) => Promise<unknown>]> = [];
export function registerSweep(name: string, fn: (now: Date) => Promise<unknown>) { extra.push([name, fn]); }

export async function runDailySweeps(now: Date = new Date()): Promise<SweepResult> {
  const out: SweepResult = {};
  for (const [name, fn] of [...SWEEPS, ...extra]) {
    try { out[name] = await fn(now); } catch (error) { out[name] = { error: error instanceof Error ? error.message : String(error) }; }
  }
  return out;
}
