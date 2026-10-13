import Link from "next/link";

export default function InventoryLayout({ children }: LayoutProps<"/inventory">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <nav className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        <Link href="/" className="underline">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/inventory" className="underline">Inventory</Link>
        <span className="mx-2">·</span>
        <Link href="/inventory/reports" className="underline">Reports</Link>
      </nav>
      {children}
    </div>
  );
}
