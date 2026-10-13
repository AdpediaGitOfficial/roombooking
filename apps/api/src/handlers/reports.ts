import type { ApiContract } from "@sam/contract/index";
import { occupancyCsv } from "@sam/core/modules/reports/service";
import { facilityCsv, keyCsv, maintenanceCsv, movementCsv, parseRange, scopeFor } from "@sam/core/modules/reports/suite";
import { dashboardView, facilitiesView, keysView, maintenanceView, movementsView, overviewView } from "@sam/core/modules/reports/views";
import type { Handlers } from "../register";

const csvFile = (csv: string, name: string) => ({ body: new TextEncoder().encode(csv), contentType: "text/csv; charset=utf-8", fileName: `${name}-${new Date().toISOString().slice(0, 10)}.csv` });

export const reportHandlers: Handlers<ApiContract>["reports"] = {
  dashboard: (_ctx, input) => dashboardView(input.siteId ?? null),
  overview: (ctx) => overviewView(ctx.user),
  movements: (ctx, input) => movementsView(ctx.user, input),
  maintenance: (ctx, input) => maintenanceView(ctx.user, input),
  facilities: (ctx, input) => facilitiesView(ctx.user, input),
  keys: (ctx, input) => keysView(ctx.user, input),
  async occupancyCsv(ctx, input) {
    return csvFile(await occupancyCsv(input.siteId ?? null, ctx.user.id), "occupancy");
  },
  async movementsCsv(ctx, input) {
    const scope = await scopeFor(ctx.user);
    return csvFile(await movementCsv(scope, { siteId: input.siteId ?? null, buildingId: input.buildingId ?? null, status: input.status ?? null, q: input.q ?? null, range: parseRange(input.from, input.to) }, ctx.user.id), "movements");
  },
  async maintenanceCsv(ctx, input) {
    const scope = await scopeFor(ctx.user);
    return csvFile(await maintenanceCsv(scope, { siteId: input.siteId ?? null, buildingId: input.buildingId ?? null, category: input.category ?? null, status: input.status ?? null, range: parseRange(input.from, input.to) }, ctx.user.id), "maintenance");
  },
  async facilitiesCsv(ctx, input) {
    const scope = await scopeFor(ctx.user);
    return csvFile(await facilityCsv(scope, { siteId: input.siteId ?? null, facilityId: input.facilityId ?? null, range: parseRange(input.from, input.to) }, ctx.user.id), "facilities");
  },
  async keysCsv(ctx, input) {
    const scope = await scopeFor(ctx.user);
    return csvFile(await keyCsv(scope, { siteId: input.siteId ?? null, buildingId: input.buildingId ?? null, status: input.status ?? null, range: parseRange(input.from, input.to) }, ctx.user.id), "keys");
  },
};
