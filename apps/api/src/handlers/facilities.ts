import type { ApiContract } from "@sam/contract/index";
import type { SessionUser } from "@sam/core/modules/auth/service";
import { FACILITY_MANAGE_ROLES, FACILITY_OPERATE_ROLES } from "@sam/core/modules/facilities/access";
import { amendBooking, cancelBooking, createBooking, createFacility, decideBooking, getFacilityView, getMyFacilityView, getMyOverview, getOverview, recordAttendance, saveFacilitySettings, type Actor } from "@sam/core/modules/facilities/service";
import type { Handlers } from "../register";

/** The facilities module's view of the signed-in user, decided from their verified roles. */
function actorFor(user: SessionUser): Actor {
  const roles = user.roleAssignments.map((r) => r.role);
  return { id: user.id, isManager: roles.some((r) => FACILITY_MANAGE_ROLES.includes(r)), isOperator: roles.some((r) => FACILITY_OPERATE_ROLES.includes(r)) };
}

export const facilityHandlers: Handlers<ApiContract>["facilities"] = {
  overview: () => getOverview(),
  mine: (ctx) => getMyOverview(ctx.user.id),
  getMine: (ctx, input) => getMyFacilityView(ctx.user.id, input.id, input.date, input.amend),
  get: (ctx, input) => getFacilityView(input.id, input.date, actorFor(ctx.user).isOperator),
  create: (ctx, input) => createFacility({ siteId: input.siteId, actorId: ctx.user.id, code: input.code, name: input.name, capacity: input.capacity }),
  update: (ctx, input) => saveFacilitySettings(ctx.user.id, input.id, input.fields),
  book: (ctx, input) =>
    createBooking({ facilityId: input.id, userId: input.userId ?? ctx.user.id, actor: actorFor(ctx.user), date: input.date, startTime: input.startTime, durationMinutes: input.durationMinutes, headcount: input.headcount, purpose: input.purpose || null, idempotencyKey: input.idempotencyKey || null }),
  amend: (ctx, input) => amendBooking({ bookingId: input.id, actor: actorFor(ctx.user), date: input.date, startTime: input.startTime, durationMinutes: input.durationMinutes, headcount: input.headcount }),
  cancel: (ctx, input) => cancelBooking({ bookingId: input.id, actor: actorFor(ctx.user), reason: input.reason || null }),
  decide: (ctx, input) => decideBooking({ bookingId: input.id, actor: actorFor(ctx.user), approve: input.approve, note: input.note || null }),
  attendance: (ctx, input) => recordAttendance({ bookingId: input.id, actor: actorFor(ctx.user), attended: input.attended }),
};
