"use client";

import { useActionState } from "react";
import { forcedPasswordChangeAction, type PasswordState } from "./actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<PasswordState, FormData>(forcedPasswordChangeAction, {});
  const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-base";
  return (
    <form action={action} className="space-y-5" noValidate>
      <div>
        <label htmlFor="currentPassword" className="block text-sm font-medium">Current or temporary password</label>
        <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className={input} />
      </div>
      <div>
        <label htmlFor="newPassword" className="block text-sm font-medium">New password</label>
        <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required className={input} />
        <p className="mt-1 text-xs text-zinc-500">At least 10 characters with upper and lower case letters and a number.</p>
      </div>
      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium">Confirm new password</label>
        <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className={input} />
      </div>
      {state.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-ink disabled:opacity-60">{pending ? "Saving…" : "Save password"}</button>
    </form>
  );
}
