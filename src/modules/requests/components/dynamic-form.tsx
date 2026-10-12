"use client";

import { useActionState } from "react";
import type { FormField } from "../forms";
import { resubmitRequestAction, submitRequestAction, type FormState } from "../actions";

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900";
const button = "mt-6 w-full rounded-md bg-zinc-900 px-4 py-3 text-base font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";

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

      <div className="space-y-5">
        {props.fields.map((field) => {
          const id = `f-${field.name}`;
          const err = errors[field.name];
          const describedBy = [field.help ? `${id}-help` : null, err ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
          const common = { id, name: field.name, "aria-describedby": describedBy, "aria-invalid": err ? true : undefined };
          return (
            <div key={field.name} data-field={field.name}>
              {field.type === "checkbox" ? (
                <label htmlFor={id} className="flex items-start gap-3 text-sm">
                  <input {...common} type="checkbox" defaultChecked={values[field.name] === "on"} className="mt-1 h-5 w-5" />
                  <span>{field.label}{field.required && " *"}</span>
                </label>
              ) : (
                <>
                  <label htmlFor={id} className="block text-sm font-medium">{field.label}{field.required && " *"}</label>
                  {field.type === "textarea" ? (
                    <textarea {...common} rows={3} defaultValue={values[field.name] ?? ""} placeholder={field.placeholder} className={input} />
                  ) : field.type === "select" ? (
                    <select {...common} defaultValue={values[field.name] ?? ""} className={input}>
                      <option value="">Select…</option>
                      {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      {...common}
                      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                      inputMode={field.type === "number" ? "numeric" : undefined}
                      min={field.min}
                      max={field.max}
                      defaultValue={values[field.name] ?? ""}
                      placeholder={field.placeholder}
                      className={input}
                    />
                  )}
                </>
              )}
              {field.help && <p id={`${id}-help`} className="mt-1 text-xs text-zinc-500">{field.help}</p>}
              {err && <p id={`${id}-err`} role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">{err}</p>}
            </div>
          );
        })}
      </div>

      {state.error && <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{state.error}</p>}
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Submitting…" : props.mode === "submit" ? "Submit request" : "Resubmit request"}
      </button>
    </form>
  );
}
