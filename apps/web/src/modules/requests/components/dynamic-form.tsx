"use client";

import { useActionState, useState } from "react";
import { visibleFields, type FormField } from "@sam/core/modules/requests/forms";
import { resubmitRequestAction, submitRequestAction, type FormState } from "../actions";

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-base";
const button = "mt-6 w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-ink disabled:opacity-60";

/** Renders the fields that are visible for the current values; tracks changes so conditional fields show and hide as the person types (WF-02). */
export function FieldList({ fields, values, errors, preview }: { fields: FormField[]; values: Record<string, string>; errors: Record<string, string>; preview?: boolean }) {
  const [current, setCurrent] = useState<Record<string, string>>(values);
  const shown = visibleFields(fields, current);
  const track = (name: string, value: string) => setCurrent((c) => (c[name] === value ? c : { ...c, [name]: value }));
  return (
    <div className="space-y-5" data-visible-count={shown.length}>
      {shown.map((field) => {
        const id = `f-${field.name}`;
        const err = errors[field.name];
        const describedBy = [field.help ? `${id}-help` : null, err ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
        const common = { id, name: field.name, "aria-describedby": describedBy, "aria-invalid": err ? true : undefined, disabled: preview };
        const options = field.optionsSource && !field.options?.length ? [`(${field.optionsSource})`] : (field.options ?? []);
        return (
          <div key={field.name} data-field={field.name}>
            {field.type === "checkbox" ? (
              <label htmlFor={id} className="flex items-start gap-3 text-sm">
                <input {...common} type="checkbox" defaultChecked={values[field.name] === "on"} onChange={(e) => track(field.name, e.target.checked ? "on" : "")} className="mt-1 h-5 w-5" />
                <span>{field.label}{field.required && " *"}</span>
              </label>
            ) : (
              <>
                <label htmlFor={id} className="block text-sm font-medium">{field.label}{field.required && " *"}</label>
                {field.type === "textarea" ? (
                  <textarea {...common} rows={3} defaultValue={values[field.name] ?? ""} placeholder={field.placeholder} onChange={(e) => track(field.name, e.target.value)} className={input} />
                ) : field.type === "select" ? (
                  <select {...common} defaultValue={values[field.name] ?? ""} onChange={(e) => track(field.name, e.target.value)} className={input}>
                    <option value="">Select…</option>
                    {options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    {...common}
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                    inputMode={field.type === "number" ? "numeric" : undefined}
                    min={field.min}
                    max={field.max}
                    maxLength={field.maxLength}
                    defaultValue={values[field.name] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(e) => track(field.name, e.target.value)}
                    className={input}
                  />
                )}
              </>
            )}
            {field.help && <p id={`${id}-help`} className="mt-1 text-xs text-zinc-500">{field.help}</p>}
            {err && <p id={`${id}-err`} role="alert" className="mt-1 text-sm text-red-700">{err}</p>}
          </div>
        );
      })}
      {shown.length === 0 && <p className="text-sm text-zinc-500">This form has no fields yet.</p>}
    </div>
  );
}

type Props =
  | { mode: "submit"; typeCode: string; idempotencyKey: string; fields: FormField[]; initialValues: Record<string, string> }
  | { mode: "resubmit"; requestId: string; fields: FormField[]; initialValues: Record<string, string> };

export function DynamicForm(props: Props) {
  const action = props.mode === "submit" ? submitRequestAction : resubmitRequestAction;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const values = state.values ?? props.initialValues;
  const errors = state.fieldErrors ?? {};
  // Remount after a failed submission so selects and checkboxes are restored
  // from the returned values (React applies a select's defaultValue only on mount).
  const formKey = state.values ? JSON.stringify(state.values) : "initial";

  return (
    <form key={formKey} action={formAction} noValidate>
      {props.mode === "submit" ? (
        <>
          <input type="hidden" name="typeCode" value={props.typeCode} />
          <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
        </>
      ) : (
        <input type="hidden" name="requestId" value={props.requestId} />
      )}
      <FieldList fields={props.fields} values={values} errors={errors} />
      {state.error && <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Submitting…" : props.mode === "submit" ? "Submit request" : "Resubmit request"}
      </button>
    </form>
  );
}
