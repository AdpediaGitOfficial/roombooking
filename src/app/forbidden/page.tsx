import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold">Access denied</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Your account does not have permission to view this page.
      </p>
      <Link href="/" className="mt-6 underline">
        Back to home
      </Link>
    </main>
  );
}
