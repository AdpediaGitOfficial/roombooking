import { Suspense } from "react";
import { requireCapability } from "@/lib/auth/authorize";
import { API_SCOPES, PUBLIC_EVENTS, listApiKeys, listIntegrations, listSyncRuns, listWebhooks, systemHealth } from "@sam/core/modules/integrations/service";
import { ActionForm } from "@/components/forms/action-form";
import { apiKeyAction, configureAction, hrmsCsvAction, revokeKeyAction, webhookAction, webhookToggleAction } from "@/modules/integrations/actions";
import { SecretForm } from "@/modules/integrations/secret-form";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("setup.integrations", { returnTo: "/admin/integrations", level: "access" });
  const org = user.organizationId;
  const [integrations, keys, hooks, runs, health] = await Promise.all([listIntegrations(org), listApiKeys(org), listWebhooks(org), listSyncRuns(org), systemHealth(org)]);
  const t = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");
  return (
    <div className="space-y-6">
      <section className="panel"><div className="toolbar"><h2 className="font-medium">System health</h2><span className={`chip ml-2 ${health.ok ? "chip-success" : "chip-danger"}`}>{health.ok ? "all good" : "needs attention"}</span><span className="ml-auto text-xs text-zinc-500">as of {t(health.asOf)} UTC</span></div>
        <ul className="divide-y divide-zinc-200">{health.checks.map((c) => <li key={c.name} className="flex items-start gap-3 px-4 py-2 text-sm"><span className={c.ok ? "text-green-700" : "text-red-700"}>{c.ok ? "✓" : "✗"}</span><span><b>{c.name}</b><span className="block text-xs text-zinc-500">{c.detail}</span></span></li>)}</ul></section>

      <section className="grid gap-4 lg:grid-cols-2">
        {integrations.map((i) => (
          <div key={i.kind} className="card p-4">
            <div className="flex justify-between gap-2"><h3 className="font-medium">{i.label}</h3><span className={`chip ${i.config?.enabled ? "chip-success" : ""}`}>{i.config?.enabled ? "on" : "off"}</span></div>
            <p className="text-xs text-zinc-500">{i.hint}</p>
            {i.config?.lastSyncAt && <p className="mt-1 text-xs">Last sync {t(i.config.lastSyncAt)} · {i.config.lastStatus?.toLowerCase()}{i.config.lastError ? ` · ${i.config.lastError}` : ""}</p>}
            <div className="mt-2"><ActionForm compact tone="secondary" action={configureAction} hidden={{ kind: i.kind }} submit="Save" fields={[{ name: "enabled", label: "Enabled", type: "checkbox", defaultValue: i.config?.enabled ?? false }, { name: "settings", label: "Settings (JSON, optional)", type: "textarea", placeholder: '{"endpoint":"https://hr.example.com"}' }]} /></div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="panel"><div className="toolbar"><h2 className="font-medium">Sync monitor</h2></div>
          <table className="table"><thead><tr><th>Started</th><th>Integration</th><th>Trigger</th><th>Status</th><th>Created</th><th>Updated</th><th>Failed</th></tr></thead><tbody>
            {runs.map((r) => <tr key={r.id}><td className="tabular-nums">{t(r.startedAt)}</td><td>{r.integration.kind}</td><td>{r.trigger}</td><td><span className={`chip ${r.status === "OK" ? "chip-success" : r.status === "RUNNING" ? "" : "chip-danger"}`}>{r.status.toLowerCase()}</span></td><td>{r.created}</td><td>{r.updated}</td><td>{r.failed}</td></tr>)}
            {runs.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-zinc-500">No sync runs yet.</td></tr>}
          </tbody></table></div>
        <ActionForm action={hrmsCsvAction} title="Run an HRMS sync from CSV" intro="Header: employeeId,firstName,lastName,department,grade,gender,phone,email,joiningDate,status,lastDay. The HRMS owns identity and dates; status EXITED with a last day opens an exit." submit="Run sync" fields={[{ name: "csv", label: "CSV", type: "textarea", required: true }]} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="panel"><div className="toolbar"><h2 className="font-medium">API keys</h2></div><ul className="divide-y divide-zinc-200">
            {keys.map((k) => <li key={k.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm"><span><b>{k.name}</b> <code className="text-xs">{k.prefix}…</code><span className="block text-xs text-zinc-500">{k.scopes.join(", ")} · {k.revokedAt ? "revoked" : k.expiresAt ? `expires ${t(k.expiresAt)}` : "no expiry"} · last used {t(k.lastUsedAt)}</span></span>{!k.revokedAt && <ActionForm compact tone="danger" action={revokeKeyAction} hidden={{ id: k.id }} submit="Revoke" />}</li>)}
            {keys.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">No API keys.</li>}</ul></div>
          <SecretForm action={apiKeyAction} title="New API key" submit="Create key" secretLabel="API key (shown once)" fields={[{ name: "name", label: "Name" }, { name: "scopes", label: "Scopes", type: "multiselect", options: API_SCOPES.map((s) => ({ value: s.scope, label: s.label })) }, { name: "expiresAt", label: "Expires (optional)", type: "date" }]} />
          <p className="text-xs text-zinc-500">HRMS push: <code>POST /api/v1/hrms/sync</code> with <code>Authorization: Bearer &lt;key&gt;</code> and a JSON body <code>{`{"records":[{"employeeId":"E1","firstName":"A","lastName":"B"}]}`}</code>. Occupancy: <code>GET /api/v1/occupancy</code>.</p>
        </div>
        <div className="space-y-3">
          <div className="panel"><div className="toolbar"><h2 className="font-medium">Webhooks</h2></div><ul className="divide-y divide-zinc-200">
            {hooks.map((h) => <li key={h.id} className="px-4 py-2 text-sm"><div className="flex items-center justify-between gap-3"><span className="break-all"><b>{h.url}</b><span className="block text-xs text-zinc-500">{h.events.join(", ")} · {h.active ? "active" : "off"} · {h.failureCount} failure(s) · last {t(h.lastDeliveryAt)} {h.lastStatus ?? ""}</span></span><ActionForm compact tone="secondary" action={webhookToggleAction} hidden={{ id: h.id, active: h.active ? "0" : "1" }} submit={h.active ? "Turn off" : "Turn on"} /></div></li>)}
            {hooks.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">No webhooks.</li>}</ul></div>
          <SecretForm action={webhookAction} title="New webhook" submit="Create webhook" secretLabel="Signing secret (shown once)" fields={[{ name: "url", label: "HTTPS address" }, { name: "events", label: "Events", type: "multiselect", options: PUBLIC_EVENTS.map((e) => ({ value: e, label: e })) }]} />
          <p className="text-xs text-zinc-500">Each delivery is a JSON POST with <code>x-sam-signature: sha256=HMAC(secret, timestamp + "." + body)</code> and <code>x-sam-timestamp</code>. Failed deliveries retry for about 14 hours.</p>
        </div>
      </section>
    </div>
  );
}

export default function IntegrationsPage() {
  return <main><PageHeader title="Integrations & system health" subtitle="HRMS, sign-in, messaging, API keys, webhooks and the sync monitor." crumbs={[["Administration"], ["Integrations"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
