import { z } from "zod";
import { ADMIN_VIEW_ROLES, USER_ADMIN_ROLES } from "@sam/core/modules/admin/access";
import type * as svc from "@sam/core/modules/notifications/admin";
import { cuid, op, out, type Ret } from "../define";

export const notifications = {
  view: op({
    id: "notifications.view",
    method: "GET",
    path: "/v1/admin/notifications",
    summary: "Outbox statistics, recent messages on a channel, transport health and WhatsApp templates",
    tag: "Notifications",
    access: ADMIN_VIEW_ROLES,
    input: z.object({ channel: z.enum(["EMAIL", "WHATSAPP"]).default("EMAIL"), status: z.enum(["QUEUED", "SENT", "DELIVERED", "FAILED"]).optional() }),
    output: out<Ret<typeof svc.notificationsView>>(),
  }),
  runWorker: op({
    id: "notifications.runWorker",
    method: "POST",
    path: "/v1/admin/notifications/run",
    summary: "Deliver whatever is due now",
    tag: "Notifications",
    access: USER_ADMIN_ROLES,
    input: z.object({}),
    output: out<Ret<typeof svc.runOutbox>>(),
  }),
  retry: op({
    id: "notifications.retry",
    method: "POST",
    path: "/v1/admin/notifications/:id/retry",
    summary: "Queue a failed notification for another attempt",
    tag: "Notifications",
    access: USER_ADMIN_ROLES,
    input: z.object({ id: cuid() }),
    output: out<{ queued: boolean }>(),
  }),
  sendTest: op({
    id: "notifications.sendTest",
    method: "POST",
    path: "/v1/admin/notifications/test",
    summary: "Send a test email or WhatsApp message to the caller",
    tag: "Notifications",
    access: USER_ADMIN_ROLES,
    input: z.object({ channel: z.enum(["EMAIL", "WHATSAPP"]) }),
    output: out<Ret<typeof svc.sendTest>>(),
  }),
};
