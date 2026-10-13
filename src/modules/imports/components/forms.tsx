"use client";

import { useActionState } from "react";
import { commitAction, discardAction, uploadAction, type ImportState } from "../actions";

function Feedback({ state }: { state: ImportState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-300">{state.message}</p>;
  return null;
}
const primary = "rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";
const danger = "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60 dark:border-red-800 dark:text-red-300";
const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function UploadForm({ kinds }: { kinds: Array<{ kind: string; label: string }> }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(uploadAction, {});
  return (
    <form action={action} encType="multipart/form-data" className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800" data-upload>
      <h3 className="font-medium">Upload a file to preview</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <label className="block text-sm">What is in the file<select name="kind" className={input}>{kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></label>
        <label className="block text-sm">CSV file<input name="file" type="file" accept=".csv,text/csv" className="mt-1 block w-full text-sm" /></label>
        <button type="submit" disabled={pending} className={primary}>{pending ? "Checking…" : "Preview"}</button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Nothing is written at this step. You will see every row with what would happen to it before confirming.</p>
      <Feedback state={state} />
    </form>
  );
}

export function CommitForm({ batchId, errors }: { batchId: string; errors: number }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(commitAction, {});
  return (
    <form action={action} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800" data-commit>
      <input type="hidden" name="batchId" value={batchId} />
      {errors > 0 && (
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="skipErrors" className="mt-1 h-5 w-5" />
          <span>Import the valid rows and leave out the {errors} row{errors === 1 ? "" : "s"} with errors. Otherwise fix the file and upload it again.</span>
        </label>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Importing…" : "Import now"}</button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">All rows are written in one transaction; if anything fails, nothing is imported.</p>
      <Feedback state={state} />
    </form>
  );
}

export function DiscardButton({ batchId }: { batchId: string }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(discardAction, {});
  return <form action={action} className="inline-block"><input type="hidden" name="batchId" value={batchId} /><button type="submit" disabled={pending} className={danger} data-discard>Discard preview</button><Feedback state={state} /></form>;
}
