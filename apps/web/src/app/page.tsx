import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { principalOf, requireUser } from "@/lib/auth/authorize";
import { isResidentOnly } from "@/modules/self-service/context";
import { AppShell } from "@/components/shell/app-shell";
import { buildHome, type Home, type HomeItem, type Tone } from "@sam/core/modules/home/service";

const TONE: Record<Tone, string> = { danger: "var(--danger)", warning: "var(--warning)", info: "var(--info)", ok: "var(--primary)" };

function NeedsAction({ items }: { items: HomeItem[] }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="needs-action">
      <h2 id="needs-action" className="section-title">Needs action</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <li key={i.label}>
            <Link href={i.href} className="kpi" style={{ "--acc": TONE[i.tone ?? "info"] } as React.CSSProperties} data-needs={i.label}>
              <span className="kpi-label">{i.label}</span>
              <span className="kpi-value">{i.count}</span>
              {i.hint && <span className="text-xs text-zinc-500">{i.hint}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Lists({ home }: { home: Home }) {
  if (!home.lists.length) return null;
  return (
    <section className="mt-8" aria-labelledby="today">
      <h2 id="today" className="section-title">Today</h2>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {home.lists.map((l) => (
          <div key={l.title} className="panel">
            <div className="toolbar"><h3 className="font-medium">{l.title}</h3>{l.href && <Link href={l.href} className="text-xs underline">Open</Link>}</div>
            <ul className="divide-y divide-zinc-200">
              {l.rows.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <div className="min-w-0">{r.href ? <Link href={r.href} className="font-medium underline">{r.primary}</Link> : <span className="font-medium">{r.primary}</span>}{r.secondary && <div className="truncate text-xs text-zinc-500">{r.secondary}</div>}</div>
                  {r.badge && <span className="chip">{r.badge}</span>}
                </li>
              ))}
              {l.rows.length === 0 && <li className="px-4 py-4 text-sm text-zinc-500">{l.empty}</li>}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Kpis({ home }: { home: Home }) {
  if (!home.kpis.length) return null;
  return (
    <section className="mt-8" aria-labelledby="health">
      <h2 id="health" className="section-title">Health</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {home.kpis.map((k) => {
          const inner = (<><dt className="kpi-label">{k.label}</dt><dd className="kpi-value">{k.value}</dd>{k.note && <span className="text-xs text-zinc-500">{k.note}</span>}</>);
          const style = { "--acc": TONE[k.tone ?? "ok"] } as React.CSSProperties;
          return k.href ? <Link key={k.label} href={k.href} className="kpi" style={style}>{inner}</Link> : <div key={k.label} className="kpi" style={style}>{inner}</div>;
        })}
      </dl>
    </section>
  );
}

async function RoleHome() {
  const user = await requireUser("/");
  // Residents without operational roles get the mobile self-service portal.
  if (isResidentOnly(user)) redirect("/my");
  const home = await buildHome(principalOf(user), { id: user.id, organizationId: user.organizationId, name: user.name });
  if (!home) redirect("/my");
  return (
    <>
      <h1 className="page-title">{home.title}</h1>
      <p className="mt-1 text-sm text-zinc-500">{home.subtitle}</p>
      <div className="mt-6"><NeedsAction items={home.needsAction} /></div>
      <Lists home={home} />
      <Kpis home={home} />
      {home.quick.length > 0 && (
        <section className="mt-8" aria-labelledby="quick">
          <h2 id="quick" className="section-title">Quick actions</h2>
          <div className="mt-3 flex flex-wrap gap-2">{home.quick.map((q) => <Link key={q.href} href={q.href} className="btn">{q.label}</Link>)}</div>
        </section>
      )}
    </>
  );
}

export default function Home() {
  return (
    <AppShell returnTo="/">
      <Suspense fallback={<div className="h-16 animate-pulse rounded-lg bg-zinc-100" />}>
        <RoleHome />
      </Suspense>
    </AppShell>
  );
}
