"use client";

import { useActionState } from "react";
import type { Field } from "@/components/forms/action-form";
import { Feedback } from "@/components/forms/action-form";
import type { KeyState } from "./actions";

/** A create form whose result includes a secret that is shown exactly once. */
export function SecretForm({ action, title, submit, fields, secretLabel }: { action: (p: KeyState, fd: FormData) => Promise<KeyState>; title: string; submit: string; fields: Array<Field & { options?: Array<{ value: string; label: string }> }>; secretLabel: string }) {
  const [state, run, pending] = useActionState<KeyState, FormData>(action, {});
  const secret = state.token ?? state.secret;
  return (
    <form action={run} className="card p-4">
      <h3 className="font-medium">{title}</h3>
      <div className="mt-3 grid gap-3">
        {fields.map((f) => f.type === "multiselect" ? (
          <fieldset key={f.name} className="text-sm"><legend>{f.label}</legend>{(f.options ?? []).map((o) => <label key={o.value} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" name={f.name} value={o.value} /> {o.label}</label>)}</fieldset>
        ) : (
          <label key={f.name} className="block text-sm">{f.label}<input name={f.name} type={f.type ?? "text"} defaultValue={f.defaultValue as string | undefined} placeholder={f.placeholder} className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" /></label>
        ))}
      </div>
      <button type="submit" disabled={pending} className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60">{pending ? "Working…" : submit}</button>
      <Feedback state={state} />
      {secret && <div className="alert alert-warning mt-3"><span>!</span><div><b>{secretLabel}</b><code className="mt-1 block break-all rounded bg-zinc-100 p-2 text-xs">{secret}</code></div></div>}
    </form>
  );
}
