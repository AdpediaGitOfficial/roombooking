import { Suspense } from "react";
import { requireCapability } from "@/lib/auth/authorize";
import { listTemplates } from "@sam/core/modules/masters/service";
import { ActionForm } from "@/components/forms/action-form";
import { templateAction, templateResetAction } from "@/modules/masters/actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("comm.templates", { returnTo: "/admin/templates" });
  const rows = await listTemplates(user.organizationId);
  return (
    <section className="panel"><ul className="divide-y divide-zinc-200">{rows.map((t) => (
      <li key={t.event} className="px-4 py-3 text-sm"><b>{t.event}</b>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">{t.channels.map(({ channel, override }) => (
          <details key={channel} className="rounded-md border border-zinc-200 p-2"><summary className="cursor-pointer text-xs"><span className="font-medium">{channel.toLowerCase()}</span> · {override ? (override.enabled ? "customised" : "switched off") : "default"}</summary>
            <div className="mt-2"><ActionForm compact action={templateAction} hidden={{ event: t.event, channel }} submit="Save" fields={[{ name: "enabled", label: "Send this message", type: "checkbox", defaultValue: override?.enabled ?? true }, ...(channel === "EMAIL" ? [{ name: "subject", label: "Subject", defaultValue: override?.subject ?? "" }, { name: "body", label: "Body (use {{name}} and fields like {{ticketNumber}})", type: "textarea" as const, defaultValue: override?.body ?? "" }] : [])]} /></div>
            {override && <div className="mt-2"><ActionForm compact tone="secondary" action={templateResetAction} hidden={{ event: t.event, channel }} submit="Reset to default" /></div>}
          </details>))}</div></li>))}</ul></section>
  );
}

export default function TemplatesPage() {
  return <main><PageHeader title="Notification templates & channels" subtitle="Reword an email, or switch an event off for a channel. WhatsApp messages use the approved provider templates." crumbs={[["Administration"], ["Templates"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
