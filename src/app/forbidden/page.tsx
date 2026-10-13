import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3"><span className="brand-mark" aria-hidden="true">S</span><span className="text-lg font-bold tracking-tight">Staff Accommodation</span></div>
      <div className="card p-6">
      <h1 className="page-title">Access denied</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Your account does not have permission to view this page.
      </p>
      <Link href="/" className="mt-6 underline">
        Back to home
      </Link>
      </div>
    </main>
  );
}
