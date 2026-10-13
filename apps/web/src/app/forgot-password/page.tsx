import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3"><span className="brand-mark" aria-hidden="true">S</span><span className="text-lg font-bold tracking-tight">Staff Accommodation</span></div>
      <div className="card p-6">
        <h1 className="page-title">Reset your password</h1>
        <p className="mt-1 mb-8 text-sm text-zinc-600">Enter your username. If we have a registered phone or email for it, we will send a link to choose a new password.</p>
        <ForgotPasswordForm />
        <p className="mt-6 text-sm"><Link href="/login" className="underline">Back to sign in</Link></p>
      </div>
    </main>
  );
}
