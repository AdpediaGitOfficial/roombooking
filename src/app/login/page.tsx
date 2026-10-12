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
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 mb-8 text-sm text-zinc-600 dark:text-zinc-400">Staff Accommodation Management</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <LoginGate searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
