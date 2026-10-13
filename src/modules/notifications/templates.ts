// Email templates per outbox event (COM-05). Plain text and HTML; links deep
// into the app; only details the recipient already owns.

export type Rendered = { subject: string; text: string; html: string };
type Payload = Record<string, unknown>;

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const str = (p: Payload, key: string, fallback = ""): string => {
  const v = p[key];
  return v === null || v === undefined || v === "" ? fallback : String(v);
};

type Template = { subject: (p: Payload) => string; lines: (p: Payload) => string[]; path: (p: Payload) => string; cta: string };

const TEMPLATES: Record<string, Template> = {
  "allocation.confirmed": {
    subject: (p) => `Accommodation confirmed: bed ${str(p, "bed")}`,
    lines: (p) => [`You have been allocated bed ${str(p, "bed")} in ${str(p, "building")}, room ${str(p, "room")}.`, `Your stay starts on ${str(p, "startDate")}${str(p, "endDate") ? ` and ends on ${str(p, "endDate")}` : ""}. Please check in at reception on arrival.`],
    path: () => "/my/stay",
    cta: "View my stay",
  },
  "allocation.checked_out": { subject: (p) => `Checked out of bed ${str(p, "bed")}`, lines: (p) => [`Your stay in bed ${str(p, "bed")} ended on ${str(p, "endDate")}. Thank you.`], path: () => "/my/stay", cta: "View my stay" },
  "allocation.cancelled": { subject: (p) => `Allocation cancelled: bed ${str(p, "bed")}`, lines: (p) => [`Bed ${str(p, "bed")} is no longer allocated to you.`, str(p, "reason") ? `Reason: ${str(p, "reason")}` : ""], path: () => "/my/stay", cta: "View my stay" },
  "request.approved": { subject: (p) => `${str(p, "type", "Your request")} approved`, lines: (p) => [`Your ${str(p, "type", "request").toLowerCase()} has been approved.`, str(p, "comment") ? `Comment: ${str(p, "comment")}` : ""], path: (p) => `/my/requests/${str(p, "requestId")}`, cta: "Open the request" },
  "request.rejected": { subject: (p) => `${str(p, "type", "Your request")} not approved`, lines: (p) => [`Your ${str(p, "type", "request").toLowerCase()} was not approved.`, str(p, "comment") ? `Reason: ${str(p, "comment")}` : ""], path: (p) => `/my/requests/${str(p, "requestId")}`, cta: "Open the request" },
  "request.changes_requested": { subject: (p) => `${str(p, "type", "Your request")} needs changes`, lines: (p) => [`An approver has returned your ${str(p, "type", "request").toLowerCase()} for changes.`, str(p, "comment") ? `Comment: ${str(p, "comment")}` : "", "Update it and resubmit from the app."], path: (p) => `/my/requests/${str(p, "requestId")}`, cta: "Update the request" },
  "maintenance.received": { subject: (p) => `Maintenance request ${str(p, "ticketNumber")} received`, lines: (p) => [`We have logged your ${str(p, "category", "maintenance").toLowerCase()} request as ${str(p, "ticketNumber")}. The team will pick it up shortly.`], path: (p) => `/my/maintenance/${str(p, "workOrderId")}`, cta: "Track the ticket" },
  "maintenance.assigned": { subject: (p) => `${str(p, "ticketNumber")} assigned`, lines: (p) => [`Your maintenance ticket ${str(p, "ticketNumber")} has been assigned to the team.`], path: (p) => `/my/maintenance/${str(p, "workOrderId")}`, cta: "Track the ticket" },
  "maintenance.assigned_to_you": { subject: (p) => `New job: ${str(p, "ticketNumber")} (${str(p, "priority", "").toLowerCase()})`, lines: (p) => [`Ticket ${str(p, "ticketNumber")} has been assigned to you.`], path: (p) => `/maintenance/${str(p, "workOrderId")}`, cta: "Open the ticket" },
  "maintenance.waiting_on_you": { subject: (p) => `${str(p, "ticketNumber")}: we need something from you`, lines: (p) => [`The maintenance team needs a reply on ticket ${str(p, "ticketNumber")}.`, str(p, "note") ? `Note: ${str(p, "note")}` : ""], path: (p) => `/my/maintenance/${str(p, "workOrderId")}`, cta: "Reply" },
  "maintenance.resolved": { subject: (p) => `${str(p, "ticketNumber")} resolved: please confirm`, lines: (p) => [`Ticket ${str(p, "ticketNumber")} has been marked resolved.`, str(p, "note") ? `Resolution: ${str(p, "note")}` : "", "Please confirm, or reopen if the problem persists."], path: (p) => `/my/maintenance/${str(p, "workOrderId")}`, cta: "Confirm or reopen" },
  "maintenance.closed": { subject: (p) => `${str(p, "ticketNumber")} closed`, lines: (p) => [`Ticket ${str(p, "ticketNumber")} is now closed.`], path: (p) => `/my/maintenance/${str(p, "workOrderId")}`, cta: "View the ticket" },
  "maintenance.cancelled": { subject: (p) => `${str(p, "ticketNumber")} cancelled`, lines: (p) => [`Ticket ${str(p, "ticketNumber")} was cancelled.`, str(p, "note") ? `Reason: ${str(p, "note")}` : ""], path: (p) => `/my/maintenance/${str(p, "workOrderId")}`, cta: "View the ticket" },
  "maintenance.update": { subject: (p) => `${str(p, "ticketNumber")}: new update`, lines: (p) => [`There is a new note on ticket ${str(p, "ticketNumber")}.`, str(p, "note") ? str(p, "note") : ""], path: (p) => `/my/maintenance/${str(p, "workOrderId")}`, cta: "Read the update" },
  "maintenance.reopened": { subject: (p) => `${str(p, "ticketNumber")} reopened`, lines: (p) => [`The resident has reopened ticket ${str(p, "ticketNumber")}.`, str(p, "note") ? `Reason: ${str(p, "note")}` : ""], path: (p) => `/maintenance/${str(p, "workOrderId")}`, cta: "Open the ticket" },
  "key.issued": { subject: (p) => `Key ${str(p, "code")} issued to you`, lines: (p) => [`Key ${str(p, "code")}${str(p, "label") ? ` (${str(p, "label")})` : ""} has been issued to you.`, str(p, "expectedReturnAt") ? `Please return it by ${str(p, "expectedReturnAt")}.` : "Please return it at check-out."], path: () => "/my/stay", cta: "View my stay" },
  "key.returned": { subject: (p) => `Key ${str(p, "code")} returned`, lines: (p) => [`Key ${str(p, "code")} has been recorded as returned (${str(p, "condition", "good")}).`], path: () => "/my/stay", cta: "View my stay" },
  "booking.confirmed": { subject: (p) => `Booking confirmed: ${str(p, "facility")} on ${str(p, "date")}`, lines: (p) => [`Your booking of ${str(p, "facility")} on ${str(p, "date")} from ${str(p, "startTime")} to ${str(p, "endTime")} is confirmed.`], path: () => "/my/facilities", cta: "View my bookings" },
  "booking.pending": { subject: (p) => `Booking request received: ${str(p, "facility")}`, lines: (p) => [`Your request for ${str(p, "facility")} on ${str(p, "date")} at ${str(p, "startTime")} is awaiting approval by the facility manager.`], path: () => "/my/facilities", cta: "View my bookings" },
  "booking.rejected": { subject: (p) => `Booking declined: ${str(p, "facility")}`, lines: (p) => [`Your request for ${str(p, "facility")} on ${str(p, "date")} at ${str(p, "startTime")} was declined.`, str(p, "reason") ? `Reason: ${str(p, "reason")}` : ""], path: () => "/my/facilities", cta: "View my bookings" },
  "booking.cancelled": { subject: (p) => `Booking cancelled: ${str(p, "facility")}`, lines: (p) => [`Your booking of ${str(p, "facility")} on ${str(p, "date")} at ${str(p, "startTime")} was cancelled by the facility team.`, str(p, "reason") ? `Reason: ${str(p, "reason")}` : ""], path: () => "/my/facilities", cta: "View my bookings" },
  "lostfound.claim_verified": { subject: (p) => `Your claim for ${str(p, "reference")} is verified`, lines: (p) => [`Your claim for the found item ${str(p, "reference")} (${str(p, "description")}) has been verified.`, str(p, "storageLocation") ? `Collect it from ${str(p, "storageLocation")} at the accommodation office; bring your ID.` : "Contact the accommodation office to collect it; bring your ID."], path: () => "/my/lost-found", cta: "View my claims" },
  "lostfound.claim_rejected": { subject: (p) => `Your claim for ${str(p, "reference")} was not verified`, lines: (p) => [`We could not verify your claim for the found item ${str(p, "reference")}.`, str(p, "reason") ? `Reason: ${str(p, "reason")}` : ""], path: () => "/my/lost-found", cta: "View my claims" },
  "lostfound.returned": { subject: (p) => `${str(p, "reference")} handed over`, lines: (p) => [`The found item ${str(p, "reference")} (${str(p, "description")}) has been recorded as handed over to you.`], path: () => "/my/lost-found", cta: "View my claims" },
  "user.invited": { subject: () => "Your staff accommodation account", lines: () => ["An account has been created for you. Use the link below to choose a password. The link works once and expires."], path: (p) => str(p, "invitePath") || str(p, "path"), cta: "Set your password" },
  "user.password_reset": { subject: () => "Reset your password", lines: () => ["A password reset was requested for your account. Use the link below to choose a new password. If you did not ask for this, ignore this email.", "The link works once and expires."], path: (p) => str(p, "path"), cta: "Set a new password" },
};

export function renderEmail(event: string, payload: unknown, recipientName: string): Rendered {
  const p = (payload ?? {}) as Payload;
  const t = TEMPLATES[event];
  const base = appBaseUrl();
  const subject = t ? t.subject(p) : event.replace(/[._]/g, " ");
  const lines = (t ? t.lines(p) : ["You have a new notification."]).filter(Boolean);
  const link = `${base}${t ? t.path(p) : "/my"}`;
  const cta = t?.cta ?? "Open the app";
  const firstName = recipientName.split(" ")[0] || "there";

  const text = [`Hello ${firstName},`, "", ...lines, "", `${cta}: ${link}`, "", "Staff Accommodation Management", "This is an automated message; replies are not monitored."].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1d2420">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e1e0d9;border-radius:8px;padding:24px">
<p style="margin:0 0 16px">Hello ${escapeHtml(firstName)},</p>
${lines.map((l) => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(l)}</p>`).join("\n")}
<p style="margin:20px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1d2420;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px">${escapeHtml(cta)}</a></p>
<p style="margin:0;font-size:12px;color:#5d665f">If the button does not work, copy this address: ${escapeHtml(link)}</p>
</div>
<p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#5d665f">Staff Accommodation Management · automated message, replies are not monitored.</p>
</body></html>`;
  return { subject, text, html };
}

export const KNOWN_EVENTS = Object.keys(TEMPLATES);
