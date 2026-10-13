import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "./change-password-form";

async function Gate() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fchange-password");
  return (
    <>
      <h1 className="page-title">{user.mustChangePassword ? "Choose a new password" : "Change password"}</h1>
      <p className="mt-1 mb-8 text-sm text-zinc-600">
        {user.mustChangePassword ? "You signed in with a temporary password. Choose your own to continue." : `Signed in as ${user.username}.`}
      </p>
      <ChangePasswordForm />
    </>
  );
}

export default function ChangePasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3"><span className="brand-mark" aria-hidden="true">S</span><span className="text-lg font-bold tracking-tight">Staff Accommodation</span></div>
      <div className="card p-6">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <Gate />
        </Suspense>
      </div>
    </main>
  );
}
