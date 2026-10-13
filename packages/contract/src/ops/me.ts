import { z } from "zod";
import type * as selfService from "@sam/core/modules/self-service/service";
import type * as shell from "@sam/core/modules/shell/service";
import type * as search from "@sam/core/modules/search/service";
import type * as keys from "@sam/core/modules/keys/service";
import type * as inventory from "@sam/core/modules/inventory/service";
import { bool, cuid, int, op, out, type Ret } from "../define";

export const me = {
  shell: op({
    id: "me.shell",
    method: "GET",
    path: "/v1/me/shell",
    summary: "Unread count, site scope and navigation attention counts for the application shell",
    tag: "Me",
    input: z.object({}),
    output: out<Ret<typeof shell.getShellSummary>>(),
  }),
  home: op({
    id: "me.home",
    method: "GET",
    path: "/v1/me/home",
    summary: "Everything the resident home screen shows: stay, notifications and items needing a reply",
    tag: "Me",
    input: z.object({}),
    output: out<Ret<typeof selfService.getHome>>(),
  }),
  staff: op({
    id: "me.staff",
    method: "GET",
    path: "/v1/me/staff",
    summary: "The signed-in user's own staff record, or null",
    tag: "Me",
    input: z.object({}),
    output: out<Ret<typeof selfService.getStaffByUser>>(),
  }),
  stay: op({
    id: "me.stay",
    method: "GET",
    path: "/v1/me/stay",
    summary: "The resident's current, upcoming and past stays",
    tag: "Me",
    input: z.object({}),
    output: out<{ staff: Ret<typeof selfService.getStaffByUser>; stay: Ret<typeof selfService.getMyStay> | null }>(),
  }),
  heldKeys: op({
    id: "me.heldKeys",
    method: "GET",
    path: "/v1/me/keys",
    summary: "Keys the resident currently holds",
    tag: "Me",
    input: z.object({}),
    output: out<Ret<typeof keys.keysHeldBy>>(),
  }),
  heldItems: op({
    id: "me.heldItems",
    method: "GET",
    path: "/v1/me/items",
    summary: "Inventory items issued to the resident",
    tag: "Me",
    input: z.object({}),
    output: out<Ret<typeof inventory.itemsHeldBy>>(),
  }),
  notifications: op({
    id: "me.notifications",
    method: "GET",
    path: "/v1/me/notifications",
    summary: "In-app notifications, newest first, with the unread count",
    tag: "Me",
    input: z.object({ limit: int({ min: 1, max: 100, default: 20 }) }),
    output: out<{ items: Ret<typeof selfService.listMyNotifications>; unread: number }>(),
  }),
  markNotificationRead: op({
    id: "me.markNotificationRead",
    method: "POST",
    path: "/v1/me/notifications/:id/read",
    summary: "Mark one notification as read",
    tag: "Me",
    input: z.object({ id: cuid() }),
    output: out<{ updated: number }>(),
  }),
  updateProfile: op({
    id: "me.updateProfile",
    method: "PUT",
    path: "/v1/me/profile",
    summary: "Update the contact details a resident may edit about themselves",
    tag: "Me",
    input: z.object({ phone: z.string().max(40), emergencyContactName: z.string().max(200), emergencyContactPhone: z.string().max(40) }),
    output: out<Ret<typeof selfService.updateOwnProfile>>(),
  }),
  changePassword: op({
    id: "me.changePassword",
    method: "POST",
    path: "/v1/me/password",
    summary: "Change the signed-in user's password and sign out other devices",
    tag: "Me",
    input: z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }),
    output: out<{ otherSessionsRevoked: number }>(),
    rateLimit: { max: 10, windowSeconds: 60 },
  }),
  setEmailPreference: op({
    id: "me.setEmailPreference",
    method: "PUT",
    path: "/v1/me/preferences/email",
    summary: "Receive email copies of notifications",
    tag: "Me",
    input: z.object({ enabled: bool() }),
    output: out<{ enabled: boolean }>(),
  }),
  setWhatsAppPreference: op({
    id: "me.setWhatsAppPreference",
    method: "PUT",
    path: "/v1/me/preferences/whatsapp",
    summary: "WhatsApp number, switch and consent",
    tag: "Me",
    input: z.object({ number: z.string().max(40), enabled: bool(), consent: bool() }),
    output: out<{ number: string | null; enabled: boolean }>(),
  }),
};

export const searchOps = {
  all: op({
    id: "search.all",
    method: "GET",
    path: "/v1/search",
    summary: "Search people, beds and maintenance tickets the caller may see",
    tag: "Search",
    input: z.object({ q: z.string().max(100).default("") }),
    output: out<Ret<typeof search.searchAll>>(),
  }),
};
