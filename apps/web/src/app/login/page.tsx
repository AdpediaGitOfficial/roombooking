import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { safeReturnPath } from "@/lib/auth/authorize";
import { LoginForm } from "./login-form";

async function LoginGate({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const returnTo = safeReturnPath(next);
  const user = await getCurrentUser();
  if (user) redirect(returnTo);
  return <LoginForm next={returnTo} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3"><span className="brand-mark" aria-hidden="true">S</span><span className="text-lg font-bold tracking-tight">Staff Accommodation</span></div>
      <div className="card p-6">
      <h1 className="page-title">Sign in</h1>
      <p className="mt-1 mb-8 text-sm text-zinc-600">Staff Accommodation Management</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <LoginGate searchParams={searchParams} />
      </Suspense>
      </div>
    </main>
  );
}
