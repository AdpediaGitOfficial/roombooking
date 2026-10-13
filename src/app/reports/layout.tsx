import Link from "next/link";

const NAV = [["/reports", "Overview"], ["/dashboard", "Occupancy"], ["/reports/movements", "Movements"], ["/reports/maintenance", "Maintenance"], ["/reports/facilities", "Facilities"], ["/reports/keys", "Keys"]] as const;

export default function ReportsLayout({ children }: LayoutProps<"/reports">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <nav className="mb-6 flex flex-wrap gap-x-2 text-sm text-zinc-600 dark:text-zinc-400">
        <Link href="/" className="underline">Home</Link><span>/</span>
        {NAV.map(([href, label], i) => <span key={href}>{i > 0 && <span className="mr-2">·</span>}<Link href={href} className="underline">{label}</Link></span>)}
      </nav>
      {children}
    </div>
  );
}
