import { z } from "zod";
import { REPORT_VIEW_ROLES } from "@sam/core/modules/reports/access";
import type * as views from "@sam/core/modules/reports/views";
import { cuid, fileOp, isoDate, op, out, type Ret } from "../define";

const dates = { from: isoDate().optional(), to: isoDate().optional() };
const allocationStatus = z.enum(["DRAFT", "PENDING_APPROVAL", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "REJECTED", "EXPIRED"]);
const workOrderStatus = z.enum(["NEW", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "WAITING_STAFF", "WAITING_PARTS", "WAITING_ACCESS", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"]);
const keyStatus = z.enum(["AVAILABLE", "ISSUED", "LOST", "DAMAGED", "UNDER_REPAIR", "RETIRED"]);

const movementInput = z.object({ siteId: cuid().optional(), buildingId: cuid().optional(), status: allocationStatus.optional(), q: z.string().max(200).optional(), ...dates });
const maintenanceInput = z.object({ siteId: cuid().optional(), buildingId: cuid().optional(), category: z.string().max(100).optional(), status: workOrderStatus.optional(), ...dates });
const facilityInput = z.object({ siteId: cuid().optional(), facilityId: cuid().optional(), ...dates });
const keyInput = z.object({ siteId: cuid().optional(), buildingId: cuid().optional(), status: keyStatus.optional(), ...dates });

const base = { tag: "Reports", access: REPORT_VIEW_ROLES, method: "GET" as const };

export const reports = {
  dashboard: op({ id: "reports.dashboard", ...base, path: "/v1/reports/dashboard", summary: "Occupancy dashboard for a site or all sites, with its 30-day trend", input: z.object({ siteId: cuid().optional() }), output: out<Ret<typeof views.dashboardView>>() }),
  overview: op({ id: "reports.overview", ...base, path: "/v1/reports/overview", summary: "Headline numbers from every report over the last 30 days, for the caller's scope", input: z.object({}), output: out<Ret<typeof views.overviewView>>() }),
  movements: op({ id: "reports.movements", ...base, path: "/v1/reports/movements", summary: "Staff movement and allocation history", input: movementInput, output: out<Ret<typeof views.movementsView>>() }),
  maintenance: op({ id: "reports.maintenance", ...base, path: "/v1/reports/maintenance", summary: "Maintenance backlog, SLA performance and workload", input: maintenanceInput, output: out<Ret<typeof views.maintenanceView>>() }),
  facilities: op({ id: "reports.facilities", ...base, path: "/v1/reports/facilities", summary: "Facility bookings, attendance and utilisation", input: facilityInput, output: out<Ret<typeof views.facilitiesView>>() }),
  keys: op({ id: "reports.keys", ...base, path: "/v1/reports/keys", summary: "Key register state, outstanding keys and transactions", input: keyInput, output: out<Ret<typeof views.keysView>>() }),
  occupancyCsv: fileOp({ id: "reports.occupancyCsv", ...base, path: "/v1/reports/occupancy.csv", summary: "Download current occupancy as CSV (audited)", input: z.object({ siteId: cuid().optional() }) }),
  movementsCsv: fileOp({ id: "reports.movementsCsv", ...base, path: "/v1/reports/movements.csv", summary: "Download the movement report as CSV (audited)", input: movementInput }),
  maintenanceCsv: fileOp({ id: "reports.maintenanceCsv", ...base, path: "/v1/reports/maintenance.csv", summary: "Download the maintenance report as CSV (audited)", input: maintenanceInput }),
  facilitiesCsv: fileOp({ id: "reports.facilitiesCsv", ...base, path: "/v1/reports/facilities.csv", summary: "Download the facility report as CSV (audited)", input: facilityInput }),
  keysCsv: fileOp({ id: "reports.keysCsv", ...base, path: "/v1/reports/keys.csv", summary: "Download the key report as CSV (audited)", input: keyInput }),
};
