"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";

export type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime-local" | "email" | "tel" | "textarea" | "select" | "checkbox" | "password" | "multiselect";
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean | string[] | null;
  help?: string;
  wide?: boolean;
  min?: number;
  max?: number;
  step?: string;
};

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
const btn = {
  primary: "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60",
  secondary: "rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60",
  danger: "rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60",
};

export function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700">{state.message}</p>;
  return null;
}

function FieldInput({ f, state }: { f: Field; state: ActionState }) {
  const err = state.fieldErrors?.[f.name];
  const dv = f.defaultValue ?? undefined;
  let control: React.ReactNode;
  switch (f.type) {
    case "textarea":
      control = <textarea name={f.name} rows={3} defaultValue={dv as string | undefined} placeholder={f.placeholder} className={input} />;
      break;
    case "select":
      control = (
        <select name={f.name} defaultValue={(dv as string | undefined) ?? ""} className={input}>
          {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
      break;
    case "multiselect":
      control = (
        <select name={f.name} multiple defaultValue={(dv as string[] | undefined) ?? []} className={`${input} h-28`}>
          {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
      break;
    case "checkbox":
      return (
        <label className={`flex items-center gap-2 text-sm ${f.wide ? "sm:col-span-2" : ""}`}>
          <input type="checkbox" name={f.name} defaultChecked={Boolean(dv)} /> {f.label}
          {f.help && <span className="text-xs text-zinc-500">{f.help}</span>}
        </label>
      );
    default:
      control = <input name={f.name} type={f.type ?? "text"} defaultValue={dv as string | number | undefined} placeholder={f.placeholder} min={f.min} max={f.max} step={f.step} className={input} />;
  }
  return (
    <label className={`block text-sm ${f.wide || f.type === "textarea" ? "sm:col-span-2" : ""}`}>
      {f.label}{f.required ? " *" : ""}
      {control}
      {f.help && <span className="block text-xs text-zinc-500">{f.help}</span>}
      {err && <span role="alert" className="text-xs text-red-700">{err}</span>}
    </label>
  );
}

/** A server-action form described by data: one component for every simple create/decide/reason form. */
export function ActionForm({ action, fields = [], submit, title, hidden, tone = "primary", compact, intro }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  fields?: Field[];
  submit: string;
  title?: string;
  hidden?: Record<string, string | null | undefined>;
  tone?: "primary" | "secondary" | "danger";
  compact?: boolean;
  intro?: string;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={run} className={compact ? "" : "card p-4"} noValidate>
      {Object.entries(hidden ?? {}).map(([k, v]) => v != null && <input key={k} type="hidden" name={k} value={v} />)}
      {title && <h3 className="font-medium">{title}</h3>}
      {intro && <p className="mt-1 text-sm text-zinc-600">{intro}</p>}
      {fields.length > 0 && <div className={`${title || intro ? "mt-3 " : ""}grid gap-3 sm:grid-cols-2`}>{fields.map((f) => <FieldInput key={f.name} f={f} state={state} />)}</div>}
      <button type="submit" disabled={pending} className={`${btn[tone]} ${fields.length || title ? "mt-3" : ""}`}>{pending ? "Working…" : submit}</button>
      <Feedback state={state} />
    </form>
  );
}
