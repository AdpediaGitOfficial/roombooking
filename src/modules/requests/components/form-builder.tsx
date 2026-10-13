"use client";

import { useActionState, useState } from "react";
import type { Role } from "@prisma/client";
import { FIELD_TYPES, type FieldType, type FormField, type VisibilityOp } from "../forms";
import { slugify, type StepInput } from "../builder";
import { createDraftAction, createTypeAction, draftAction, updateTypeAction, type BuilderState } from "../builder-actions";
import { FieldList } from "./dynamic-form";

function Feedback({ state }: { state: BuilderState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-300">{state.message}</p>;
  return null;
}
const input = "mt-1 block w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const primary = "rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";
const secondary = "rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60 dark:border-zinc-700";
const danger = "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60 dark:border-red-800 dark:text-red-300";
const tiny = "rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-700";
const panel = "rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";
const err = (m?: string) => (m ? <span role="alert" className="text-xs text-red-700 dark:text-red-300">{m}</span> : null);
const TYPE_LABEL: Record<FieldType, string> = { text: "Short text", textarea: "Paragraph", date: "Date", number: "Number", select: "Choice", checkbox: "Checkbox" };
const OP_LABEL: Record<VisibilityOp, string> = { equals: "equals", notEquals: "does not equal", isSet: "has a value", isNotSet: "is empty", isTrue: "is ticked", isFalse: "is not ticked" };

export function CreateTypeForm() {
  const [state, action, pending] = useActionState<BuilderState, FormData>(createTypeAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} className={panel} noValidate data-create-type>
      <h3 className="font-medium">New request type</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">Code *<input name="code" defaultValue={v.code ?? ""} placeholder="e.g. PARKING_PERMIT" className={input} />{err(e.code)}</label>
        <label className="block text-sm">Name *<input name="name" defaultValue={v.name ?? ""} placeholder="e.g. Parking permit" className={input} />{err(e.name)}</label>
        <label className="block text-sm">Description<input name="description" defaultValue={v.description ?? ""} className={input} /></label>
      </div>
      <p className="mt-2 text-xs text-zinc-500">The type starts with an empty draft form; residents see it once a version is published.</p>
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Creating…" : "Create"}</button>
      <Feedback state={state} />
    </form>
  );
}

type PolicyFields = { reminderAfterDays: number; escalateAfterDays: number; escalateToRole: Role | null; expireAfterDays: number };
export function TypeSettingsForm({ type, roles }: { type: { id: string; name: string; description: string | null; status: string } & PolicyFields; roles: Role[] }) {
  const [state, action, pending] = useActionState<BuilderState, FormData>(updateTypeAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} className={panel} noValidate data-type-settings>
      <input type="hidden" name="typeId" value={type.id} />
      <h3 className="font-medium">Settings</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">Name *<input name="name" defaultValue={v.name ?? type.name} className={input} />{err(e.name)}</label>
        <label className="block text-sm">Description<input name="description" defaultValue={v.description ?? type.description ?? ""} className={input} /></label>
        <label className="block text-sm">Status<select name="status" defaultValue={v.status ?? type.status} className={input}><option value="ACTIVE">Active (residents can submit)</option><option value="INACTIVE">Inactive (hidden)</option></select></label>
      </div>
      <h4 className="mt-4 text-sm font-medium">Pending-step policy <span className="font-normal text-zinc-500">(days from when a step starts; 0 switches a rule off)</span></h4>
      <div className="mt-1 grid gap-3 sm:grid-cols-4" data-policy>
        <label className="block text-sm">Remind approvers after<input type="number" name="reminderAfterDays" min={0} max={365} defaultValue={v.reminderAfterDays ?? String(type.reminderAfterDays)} className={input} />{err(e.reminderAfterDays)}</label>
        <label className="block text-sm">Escalate after<input type="number" name="escalateAfterDays" min={0} max={365} defaultValue={v.escalateAfterDays ?? String(type.escalateAfterDays)} className={input} />{err(e.escalateAfterDays)}</label>
        <label className="block text-sm">Escalate to<select name="escalateToRole" defaultValue={v.escalateToRole ?? type.escalateToRole ?? ""} className={input}><option value="">Nobody (no escalation)</option>{roles.map((r) => <option key={r} value={r}>{r.toLowerCase().replaceAll("_", " ")}</option>)}</select>{err(e.escalateToRole)}</label>
        <label className="block text-sm">Expire after<input type="number" name="expireAfterDays" min={0} max={365} defaultValue={v.expireAfterDays ?? String(type.expireAfterDays)} className={input} />{err(e.expireAfterDays)}</label>
      </div>
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Saving…" : "Save settings"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function CreateDraftButton({ typeId, label }: { typeId: string; label: string }) {
  const [state, action, pending] = useActionState<BuilderState, FormData>(createDraftAction, {});
  return <form action={action} className="inline-block"><input type="hidden" name="typeId" value={typeId} /><button type="submit" disabled={pending} className={primary} data-create-draft>{pending ? "Working…" : label}</button><Feedback state={state} /></form>;
}

type Draft = { id: string; version: number; changeNote: string | null };

export function FormBuilder({ typeId, draft, initialFields, initialSteps, roles }: { typeId: string; draft: Draft; initialFields: FormField[]; initialSteps: StepInput[]; roles: Role[] }) {
  const [state, action, pending] = useActionState<BuilderState, FormData>(draftAction, {});
  const [fields, setFields] = useState<FormField[]>(initialFields);
  const [steps, setSteps] = useState<StepInput[]>(initialSteps);
  const [preview, setPreview] = useState(false);
  const e = state.fieldErrors ?? {};

  const setField = (i: number, patch: Partial<FormField>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) => setFields((fs) => { const n = [...fs]; const j = i + d; if (j < 0 || j >= n.length) return fs; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const addField = () => setFields((fs) => [...fs, { name: "", label: "", type: "text" }]);
  const setStep = (i: number, patch: Partial<StepInput>) => setSteps((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const moveStep = (i: number, d: -1 | 1) => setSteps((ss) => { const n = [...ss]; const j = i + d; if (j < 0 || j >= n.length) return ss; [n[i], n[j]] = [n[j], n[i]]; return n; });

  return (
    <form action={action} className={panel} noValidate data-form-builder>
      <input type="hidden" name="typeId" value={typeId} />
      <input type="hidden" name="versionId" value={draft.id} />
      <input type="hidden" name="schema" value={JSON.stringify({ fields })} />
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Draft version {draft.version}</h3>
        <button type="button" onClick={() => setPreview((p) => !p)} className={secondary} data-toggle-preview>{preview ? "Back to editing" : "Preview form"}</button>
      </div>
      {err(e.fields)}

      {preview ? (
        <div className="mt-4 rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700" data-preview>
          <p className="mb-3 text-xs text-zinc-500">How residents will see it. Conditional fields appear as you fill in the ones they depend on.</p>
          <FieldList key={JSON.stringify(fields)} fields={fields} values={{}} errors={{}} />
          {steps.length > 0 && <p className="mt-4 text-xs text-zinc-500">Approval: {steps.map((s) => s.name || "(unnamed)").join(" → ")}</p>}
        </div>
      ) : (
        <>
          <h4 className="mt-4 text-sm font-medium">Fields</h4>
          <ol className="mt-2 space-y-3">
            {fields.map((f, i) => {
              const earlier = fields.slice(0, i).filter((o) => o.name);
              const dep = f.visibleWhen ? fields.find((o) => o.name === f.visibleWhen?.field) : null;
              return (
                <li key={i} data-builder-field={i} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-zinc-500">Field {i + 1}</span>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className={tiny} aria-label="Move up">↑</button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === fields.length - 1} className={tiny} aria-label="Move down">↓</button>
                      <button type="button" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))} className={`${tiny} text-red-700 dark:text-red-300`} data-remove-field>Remove</button>
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-4">
                    <label className="block text-sm sm:col-span-2">Label *<input value={f.label} onChange={(ev) => setField(i, { label: ev.target.value, ...(!f.name || f.name === slugify(f.label) ? { name: slugify(ev.target.value) } : {}) })} className={input} />{err(e[`fields.${i}.label`])}</label>
                    <label className="block text-sm">Name <span className="text-zinc-500">(stored key)</span><input value={f.name} onChange={(ev) => setField(i, { name: ev.target.value })} className={`${input} font-mono`} />{err(e[`fields.${i}.name`])}</label>
                    <label className="block text-sm">Type<select value={f.type} onChange={(ev) => setField(i, { type: ev.target.value as FieldType, options: ev.target.value === "select" ? (f.options ?? []) : undefined, optionsSource: undefined })} className={input}>{FIELD_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>{err(e[`fields.${i}.type`])}</label>
                    <label className="block text-sm sm:col-span-2">Help text<input value={f.help ?? ""} onChange={(ev) => setField(i, { help: ev.target.value })} className={input} /></label>
                    {f.type !== "checkbox" && <label className="block text-sm">Placeholder<input value={f.placeholder ?? ""} onChange={(ev) => setField(i, { placeholder: ev.target.value })} className={input} /></label>}
                    <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={!!f.required} onChange={(ev) => setField(i, { required: ev.target.checked })} /> Required</label>
                    {f.type === "select" && (
                      <>
                        <label className="block text-sm sm:col-span-2">Options <span className="text-zinc-500">(one per line)</span><textarea rows={3} value={f.optionsSource ? "" : (f.options ?? []).join("\n")} disabled={!!f.optionsSource} onChange={(ev) => setField(i, { options: ev.target.value.split("\n") })} className={input} />{err(e[`fields.${i}.options`])}</label>
                        <label className="block text-sm">Or from data<select value={f.optionsSource ?? ""} onChange={(ev) => setField(i, { optionsSource: ev.target.value === "buildings" ? "buildings" : undefined })} className={input}><option value="">Fixed options</option><option value="buildings">Active buildings</option></select></label>
                      </>
                    )}
                    {f.type === "number" && (
                      <>
                        <label className="block text-sm">Minimum<input type="number" value={f.min ?? ""} onChange={(ev) => setField(i, { min: ev.target.value === "" ? undefined : Number(ev.target.value) })} className={input} /></label>
                        <label className="block text-sm">Maximum<input type="number" value={f.max ?? ""} onChange={(ev) => setField(i, { max: ev.target.value === "" ? undefined : Number(ev.target.value) })} className={input} />{err(e[`fields.${i}.max`])}</label>
                      </>
                    )}
                    {(f.type === "text" || f.type === "textarea") && <label className="block text-sm">Max length<input type="number" value={f.maxLength ?? ""} onChange={(ev) => setField(i, { maxLength: ev.target.value === "" ? undefined : Number(ev.target.value) })} className={input} />{err(e[`fields.${i}.maxLength`])}</label>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-2 text-sm" data-visibility>
                    <label className="block">Show only when
                      <select value={f.visibleWhen?.field ?? ""} onChange={(ev) => setField(i, { visibleWhen: ev.target.value ? { field: ev.target.value, op: fields.find((o) => o.name === ev.target.value)?.type === "checkbox" ? "isTrue" : "isSet" } : undefined })} className={input}>
                        <option value="">Always shown</option>
                        {earlier.map((o) => <option key={o.name} value={o.name}>{o.label || o.name}</option>)}
                      </select>
                    </label>
                    {f.visibleWhen && (
                      <label className="block">Condition
                        <select value={f.visibleWhen.op} onChange={(ev) => setField(i, { visibleWhen: { ...f.visibleWhen!, op: ev.target.value as VisibilityOp } })} className={input}>
                          {(dep?.type === "checkbox" ? (["isTrue", "isFalse"] as VisibilityOp[]) : (["equals", "notEquals", "isSet", "isNotSet"] as VisibilityOp[])).map((op) => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
                        </select>
                      </label>
                    )}
                    {f.visibleWhen && (f.visibleWhen.op === "equals" || f.visibleWhen.op === "notEquals") && (
                      <label className="block">Value
                        {dep?.type === "select" && !dep.optionsSource ? (
                          <select value={f.visibleWhen.value ?? ""} onChange={(ev) => setField(i, { visibleWhen: { ...f.visibleWhen!, value: ev.target.value } })} className={input}><option value="">Choose…</option>{(dep.options ?? []).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                        ) : (
                          <input value={f.visibleWhen.value ?? ""} onChange={(ev) => setField(i, { visibleWhen: { ...f.visibleWhen!, value: ev.target.value } })} className={input} />
                        )}
                      </label>
                    )}
                    {err(e[`fields.${i}.visibleWhen`])}
                  </div>
                </li>
              );
            })}
          </ol>
          <button type="button" onClick={addField} className={`${secondary} mt-3`} data-add-field>Add field</button>

          <h4 className="mt-6 text-sm font-medium">Approval route <span className="font-normal text-zinc-500">(in order; none = approved on submission)</span></h4>
          <ol className="mt-2 space-y-2">
            {steps.map((s, i) => (
              <li key={i} data-builder-step={i} className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                <span className="pb-2 text-xs text-zinc-500">Step {i + 1}</span>
                <label className="block text-sm">Name<input value={s.name} onChange={(ev) => setStep(i, { name: ev.target.value })} className={input} />{err(e[`steps.${i}.name`])}</label>
                <label className="block text-sm">Approver role<select value={s.approverRole} onChange={(ev) => setStep(i, { approverRole: ev.target.value as Role })} className={input}>{roles.map((r) => <option key={r} value={r}>{r.toLowerCase().replaceAll("_", " ")}</option>)}</select>{err(e[`steps.${i}.approverRole`])}</label>
                <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={s.requireComment} onChange={(ev) => setStep(i, { requireComment: ev.target.checked })} /> Comment required</label>
                <span className="flex gap-1 pb-2">
                  <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} className={tiny} aria-label="Move up">↑</button>
                  <button type="button" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className={tiny} aria-label="Move down">↓</button>
                  <button type="button" onClick={() => setSteps((ss) => ss.filter((_, j) => j !== i))} className={`${tiny} text-red-700 dark:text-red-300`}>Remove</button>
                </span>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => setSteps((ss) => [...ss, { name: "", approverRole: "APPROVER", requireComment: false }])} className={`${secondary} mt-3`} data-add-step>Add step</button>
        </>
      )}

      <label className="mt-6 block text-sm">What changed <span className="text-zinc-500">(kept with the version)</span><input name="changeNote" defaultValue={draft.changeNote ?? ""} className={input} /></label>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" name="intent" value="save" disabled={pending} className={secondary}>Save draft</button>
        <button type="submit" name="intent" value="publish" disabled={pending} className={primary}>{pending ? "Working…" : "Publish"}</button>
        <button type="submit" name="intent" value="discard" disabled={pending} className={danger}>Discard draft</button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
