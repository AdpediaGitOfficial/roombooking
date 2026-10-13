import Link from "next/link";
import { formatKpi, type KpiValue } from "@sam/core/modules/kpi/service";

/** One KPI with its definition as a tooltip, the change on the last period and the target. */
export function KpiTile({ k }: { k: KpiValue }) {
  const good = k.delta == null || k.delta === 0 ? null : (k.delta > 0) === k.higherIsBetter;
  const tip = `${k.name}\nFormula: ${k.formula}\nSource: ${k.source}\nOwner: ${k.owner}`;
  const body = (
    <>
      <dt className="kpi-label" title={tip}>{k.name} <span aria-hidden="true" className="text-zinc-400">ⓘ</span></dt>
      <dd className="kpi-value" data-kpi={k.key}>{formatKpi(k.value, k.unit as never)}</dd>
      <dd className="kpi-foot text-xs">
        {k.delta != null && k.delta !== 0 && <span className={`chip ${good ? "chip-success" : "chip-warning"}`}>{k.delta > 0 ? "▲" : "▼"} {Math.abs(k.delta)} vs last period</span>}
        {k.delta === 0 && <span className="chip">no change</span>}
        {k.target != null && <span className={`chip ${k.status === "ok" ? "chip-success" : k.status === "warn" ? "chip-warning" : "chip-danger"}`}>target {k.target}</span>}
      </dd>
    </>
  );
  return k.href ? <Link href={k.href} className="kpi">{body}</Link> : <div className="kpi">{body}</div>;
}

export function KpiGroups({ values }: { values: KpiValue[] }) {
  const groups = [...new Set(values.map((v) => v.group))];
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g}>
          <h3 className="section-title">{g}</h3>
          <dl className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{values.filter((v) => v.group === g).map((v) => <KpiTile key={v.key} k={v} />)}</dl>
        </section>
      ))}
    </div>
  );
}
