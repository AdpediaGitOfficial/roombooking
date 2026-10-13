import type { Range } from "../suite";

type Site = { id: string; name: string; buildings: Array<{ id: string; name: string }> };
export type FilterValues = { siteId?: string | null; buildingId?: string | null; status?: string | null; category?: string | null; facilityId?: string | null; q?: string | null };

const sel = "mt-1 block rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** GET filter bar shared by the report pages (RPT-06): date range, site, building, plus report-specific selects. */
export function ReportFilters(props: {
  action: string; range: Range; sites: Site[]; values: FilterValues; csvHref: string;
  statuses?: Array<[string, string]>; categories?: string[]; facilities?: Array<{ id: string; name: string; siteId: string }>; search?: string;
}) {
  const { values: v } = props;
  const buildings = props.sites.filter((s) => !v.siteId || s.id === v.siteId).flatMap((s) => s.buildings.map((b) => ({ id: b.id, label: props.sites.length > 1 && !v.siteId ? `${s.name} · ${b.name}` : b.name })));
  return (
    <form method="get" action={props.action} className="flex flex-wrap items-end gap-2 text-sm" data-report-filters>
      <label className="block">From<input type="date" name="from" defaultValue={props.range.from} className={sel} /></label>
      <label className="block">To<input type="date" name="to" defaultValue={props.range.to} className={sel} /></label>
      <label className="block">Site<select name="siteId" defaultValue={v.siteId ?? ""} className={sel}><option value="">All sites</option>{props.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {buildings.length > 0 && <label className="block">Building<select name="buildingId" defaultValue={v.buildingId ?? ""} className={sel}><option value="">All</option>{buildings.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>}
      {props.statuses && <label className="block">Status<select name="status" defaultValue={v.status ?? ""} className={sel}><option value="">All</option>{props.statuses.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select></label>}
      {props.categories && <label className="block">Category<select name="category" defaultValue={v.category ?? ""} className={sel}><option value="">All</option>{props.categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>}
      {props.facilities && <label className="block">Facility<select name="facilityId" defaultValue={v.facilityId ?? ""} className={sel}><option value="">All</option>{props.facilities.filter((f) => !v.siteId || f.siteId === v.siteId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      {props.search && <label className="block">{props.search}<input name="q" defaultValue={v.q ?? ""} className={sel} /></label>}
      <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">Apply</button>
      <a href={props.csvHref} data-csv className="rounded-md bg-zinc-900 px-3 py-1.5 text-white dark:bg-zinc-100 dark:text-zinc-900">Download CSV</a>
    </form>
  );
}

export function Definitions({ lines, masked }: { lines: string[]; masked: boolean }) {
  return (
    <details className="mt-6 text-sm text-zinc-600 dark:text-zinc-400" data-definitions>
      <summary className="cursor-pointer font-medium text-zinc-800 dark:text-zinc-200">How these figures are calculated</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {lines.map((l) => <li key={l}>{l}</li>)}
        <li>{masked ? "Your role sees employee IDs only; names are left out of this report and its export." : "Names appear because your role manages residents; auditors see employee IDs only."} Exports are recorded in the audit log.</li>
      </ul>
    </details>
  );
}

export function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt><dd data-stat={label} className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>{note && <dd className="text-xs text-zinc-500">{note}</dd>}</div>;
}

export const th = "px-3 py-2";
export const td = "px-3 py-2";
export const table = "w-full text-sm";
export const thead = "bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900";
export const tbody = "divide-y divide-zinc-200 dark:divide-zinc-800";
export const wrap = "mt-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800";
export const qs = (o: Record<string, string | null | undefined>) => new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString();
