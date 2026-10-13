import Link from "next/link";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <nav className="mb-6 flex flex-wrap gap-x-2 text-sm text-zinc-600 dark:text-zinc-400">
        <Link href="/" className="underline">Home</Link><span>/</span>
        <Link href="/admin/users" className="underline">Users</Link><span>·</span>
        <Link href="/admin/audit" className="underline">Audit log</Link><span>·</span>
        <Link href="/admin/notifications" className="underline">Notifications</Link><span>·</span>
        <Link href="/admin/broadcasts" className="underline">Broadcasts</Link><span>·</span>
        <Link href="/admin/forms" className="underline">Forms</Link><span>·</span>
        <Link href="/admin/import" className="underline">Import</Link>
      </nav>
      {children}
    </div>
  );
}
