"use client";

import { useActionState } from "react";
import { forgotPasswordAction, type ForgotState } from "./actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(forgotPasswordAction, {});
  if (state.sent) {
    return <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">If that account exists and has a registered phone or email, a reset link is on its way. If nothing arrives, ask your administrator to reset your password.</p>;
  }
  return (
    <form action={action} className="space-y-5" noValidate>
      <div>
        <label htmlFor="username" className="block text-sm font-medium">Username</label>
        <input id="username" name="username" type="text" autoCapitalize="none" spellCheck={false} placeholder="Employee ID, phone number or email" required className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-base" />
      </div>
      <button type="submit" disabled={pending} className="w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-ink disabled:opacity-60">{pending ? "Sending…" : "Send reset link"}</button>
    </form>
  );
}
