import Link from "next/link";

export default function ApprovalsLayout({ children }: LayoutProps<"/approvals">) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <nav className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        <Link href="/" className="underline">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/approvals" className="underline">Approvals</Link>
      </nav>
      {children}
    </div>
  );
}
