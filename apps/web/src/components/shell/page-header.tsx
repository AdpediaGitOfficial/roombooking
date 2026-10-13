import Link from "next/link";

export type Crumb = [label: string, href?: string];

/** Breadcrumb, title, one-line purpose and the page's actions, in the shell's header pattern. */
export function PageHeader({ crumbs, title, subtitle, actions, status }: { crumbs?: Crumb[]; title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; status?: React.ReactNode }) {
  const trail: Crumb[] = [["Home", "/"], ...(crumbs ?? [])];
  return (
    <div className="page-head">
      <div className="min-w-0">
        <div className="crumb">
          {trail.map(([label, href], i) => (
            <span key={`${label}-${i}`}>
              {i > 0 && <span className="mx-1.5">/</span>}
              {href && i < trail.length - 1 ? <Link href={href}>{label}</Link> : <b>{label}</b>}
            </span>
          ))}
        </div>
        <h1 className="page-title flex flex-wrap items-center gap-3">{title}{status}</h1>
        {subtitle && <p className="text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
