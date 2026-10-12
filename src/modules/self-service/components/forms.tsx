"use client";

import { useActionState } from "react";
import { changePasswordAction, updateProfileAction, type ActionState } from "../actions";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-300">{state.message}</p>;
  return null;
}

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900";
const button = "mt-4 w-full rounded-md bg-zinc-900 px-4 py-3 text-base font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";

export function ProfileForm(props: { phone: string; emergencyContactName: string; emergencyContactPhone: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateProfileAction, {});
  return (
    <form action={action}>
      <label htmlFor="phone" className="block text-sm font-medium">Mobile phone</label>
      <input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={props.phone} className={input} />
      <label htmlFor="emergencyContactName" className="mt-4 block text-sm font-medium">Emergency contact name</label>
      <input id="emergencyContactName" name="emergencyContactName" defaultValue={props.emergencyContactName} className={input} />
      <label htmlFor="emergencyContactPhone" className="mt-4 block text-sm font-medium">Emergency contact phone</label>
      <input id="emergencyContactPhone" name="emergencyContactPhone" type="tel" defaultValue={props.emergencyContactPhone} className={input} />
      <button type="submit" disabled={pending} className={button}>{pending ? "Saving…" : "Save changes"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(changePasswordAction, {});
  return (
    <form action={action}>
      <label htmlFor="currentPassword" className="block text-sm font-medium">Current password</label>
      <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className={input} />
      <label htmlFor="newPassword" className="mt-4 block text-sm font-medium">New password</label>
      <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={10} className={input} />
      <p className="mt-1 text-xs text-zinc-500">At least 10 characters with letters and numbers.</p>
      <label htmlFor="confirmPassword" className="mt-4 block text-sm font-medium">Confirm new password</label>
      <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className={input} />
      <button type="submit" disabled={pending} className={button}>{pending ? "Changing…" : "Change password"}</button>
      <Feedback state={state} />
    </form>
  );
}
