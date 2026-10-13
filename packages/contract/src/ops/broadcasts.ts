import { z } from "zod";
import type { Role } from "@prisma/client";
import { ALL_ROLES } from "@sam/core/modules/admin/access";
import { BROADCAST_ROLES } from "@sam/core/modules/broadcasts/access";
import type * as svc from "@sam/core/modules/broadcasts/service";
import { bool, cuid, op, out, type Ret } from "../define";

const role = z.enum(ALL_ROLES as [Role, ...Role[]]);
const audience = z.object({ roles: z.array(role).default([]), siteIds: z.array(cuid()).default([]), buildingIds: z.array(cuid()).default([]) });
const content = { title: z.string().max(300), body: z.string().max(5000), audience, emailCopy: bool().default(false), whatsappCopy: bool().default(false) };

export const broadcasts = {
  list: op({
    id: "broadcasts.list",
    method: "GET",
    path: "/v1/broadcasts",
    summary: "Broadcasts with their audiences, and the compose form's choices",
    tag: "Broadcasts",
    access: BROADCAST_ROLES,
    input: z.object({}),
    output: out<Ret<typeof svc.broadcastsView>>(),
  }),
  get: op({
    id: "broadcasts.get",
    method: "GET",
    path: "/v1/broadcasts/:id",
    summary: "One broadcast with delivery progress and, for a draft, who it would reach",
    tag: "Broadcasts",
    access: BROADCAST_ROLES,
    input: z.object({ id: cuid() }),
    output: out<Ret<typeof svc.broadcastView>>(),
  }),
  preview: op({
    id: "broadcasts.preview",
    method: "POST",
    path: "/v1/broadcasts/preview",
    summary: "Count the people an audience reaches right now",
    tag: "Broadcasts",
    access: BROADCAST_ROLES,
    input: z.object({ audience }),
    output: out<Ret<typeof svc.previewAudience>>(),
  }),
  save: op({
    id: "broadcasts.save",
    method: "POST",
    path: "/v1/broadcasts",
    summary: "Save a draft (new, or the one named by broadcastId), optionally sending it",
    tag: "Broadcasts",
    access: BROADCAST_ROLES,
    input: z.object({ broadcastId: cuid().optional(), ...content, send: bool().default(false) }),
    output: out<{ id: string }>(),
  }),
  send: op({
    id: "broadcasts.send",
    method: "POST",
    path: "/v1/broadcasts/:id/send",
    summary: "Send a draft to its audience",
    tag: "Broadcasts",
    access: BROADCAST_ROLES,
    input: z.object({ id: cuid() }),
    output: out<{ recipients: number }>(),
  }),
  cancel: op({
    id: "broadcasts.cancel",
    method: "POST",
    path: "/v1/broadcasts/:id/cancel",
    summary: "Cancel a draft",
    tag: "Broadcasts",
    access: BROADCAST_ROLES,
    input: z.object({ id: cuid() }),
    output: out<Ret<typeof svc.cancelBroadcast>>(),
  }),
  announcements: op({
    id: "broadcasts.announcements",
    method: "GET",
    path: "/v1/me/announcements",
    summary: "Announcements delivered to the signed-in user",
    tag: "Broadcasts",
    input: z.object({}),
    output: out<Ret<typeof svc.myAnnouncements>>(),
  }),
  announcement: op({
    id: "broadcasts.announcement",
    method: "GET",
    path: "/v1/me/announcements/:id",
    summary: "One announcement for its recipient; opening it marks it read",
    tag: "Broadcasts",
    input: z.object({ id: cuid() }),
    output: out<NonNullable<Ret<typeof svc.openAnnouncement>>>(),
  }),
};
