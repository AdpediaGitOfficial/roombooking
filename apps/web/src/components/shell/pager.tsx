import Link from "next/link";

/** Previous / next links for a long list. `hrefFor` builds the address of a page, keeping the other filters. */
export function Pager({ page, pages, total, pageSize, hrefFor }: { page: number; pages: number; total: number; pageSize: number; hrefFor: (page: number) => string }) {
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-4 py-3 text-sm" data-pager>
      <span className="text-zinc-500 tabular-nums">{from}–{to} of {total}</span>
      <span className="flex items-center gap-2">
        {page > 1 ? <Link href={hrefFor(page - 1)} className="btn btn-small" rel="prev">← Previous</Link> : <span className="btn btn-small btn-ghost opacity-50" aria-disabled>← Previous</span>}
        <span className="text-zinc-500 tabular-nums">Page {page} of {pages}</span>
        {page < pages ? <Link href={hrefFor(page + 1)} className="btn btn-small" rel="next">Next →</Link> : <span className="btn btn-small btn-ghost opacity-50" aria-disabled>Next →</span>}
      </span>
    </nav>
  );
}

/** Builds `/path?key=value&…&page=n`, dropping empty values. */
export function pageHref(path: string, params: Record<string, string | undefined | null>) {
  return (page: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (page > 1) q.set("page", String(page));
    const qs = q.toString();
    return qs ? `${path}?${qs}` : path;
  };
}
