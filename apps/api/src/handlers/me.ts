import type { ApiContract } from "@sam/contract/index";
import { prisma } from "@sam/core/lib/db";
import { keysHeldBy } from "@sam/core/modules/keys/service";
import { itemsHeldBy } from "@sam/core/modules/inventory/service";
import { SelfServiceError, changeOwnPassword, countUnreadNotifications, getHome, getMyStay, getStaffByUser, listMyNotifications, markNotificationRead, setEmailPreference, setWhatsAppPreference, updateOwnProfile } from "@sam/core/modules/self-service/service";
import { getShellSummary } from "@sam/core/modules/shell/service";
import { searchAll } from "@sam/core/modules/search/service";
import type { Handlers } from "../register";

export const meHandlers: Handlers<ApiContract>["me"] = {
  shell: (ctx) => getShellSummary(ctx.user),
  home: (ctx) => getHome(ctx.user.id),
  staff: (ctx) => getStaffByUser(ctx.user.id),
  async stay(ctx) {
    const staff = await getStaffByUser(ctx.user.id);
    return { staff, stay: staff ? await getMyStay(staff.id) : null };
  },
  async heldKeys(ctx) {
    const staff = await getStaffByUser(ctx.user.id);
    return staff ? keysHeldBy(staff.id) : [];
  },
  async heldItems(ctx) {
    const staff = await getStaffByUser(ctx.user.id);
    return staff ? itemsHeldBy({ staffId: staff.id }) : [];
  },
  async notifications(ctx, input) {
    const [items, unread] = await Promise.all([listMyNotifications(ctx.user.id, input.limit), countUnreadNotifications(ctx.user.id)]);
    return { items, unread };
  },
  async markNotificationRead(ctx, input) {
    return { updated: await markNotificationRead(ctx.user.id, input.id) };
  },
  async updateProfile(ctx, input) {
    const staff = await prisma.staffProfile.findUnique({ where: { userId: ctx.user.id }, select: { id: true } });
    if (!staff) throw new SelfServiceError("No staff record is linked to your account.");
    return updateOwnProfile(staff.id, ctx.user.id, input);
  },
  changePassword: (ctx, input) => changeOwnPassword({ userId: ctx.user.id, currentPassword: input.currentPassword, newPassword: input.newPassword, keepSessionToken: ctx.token }),
  setEmailPreference: (ctx, input) => setEmailPreference(ctx.user.id, input.enabled),
  setWhatsAppPreference: (ctx, input) => setWhatsAppPreference(ctx.user.id, input),
};

export const searchHandlers: Handlers<ApiContract>["search"] = {
  all: (ctx, input) => searchAll(ctx.user.roleAssignments.map((r) => r.role), input.q),
};
