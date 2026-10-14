import { Suspense } from "react";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth/authorize";
import { api, orNotFound } from "@/lib/api";
import { DynamicForm } from "@/modules/requests/components/dynamic-form";

async function FormContent({ params }: { params: Promise<{ typeCode: string }> }) {
  const { typeCode } = await params;
  await requireUser(`/my/requests/new/${typeCode}`);
  const { type, steps, fields } = await orNotFound(api.requests.form({ typeCode }));
  return (
    <>
      <h1 className="mt-1 text-2xl font-semibold">{type.name}</h1>
      {type.description && <p className="mt-1 text-sm text-zinc-600">{type.description}</p>}
      {steps.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500">Approval: {steps.map((s) => s.name).join(" → ")}</p>
      )}
      <div className="mt-6">
        <DynamicForm mode="submit" typeCode={type.code} idempotencyKey={randomUUID()} fields={fields} initialValues={{}} />
      </div>
    </>
  );
}

export default function NewRequestFormPage({ params }: PageProps<"/my/requests/new/[typeCode]">) {
  return (
    <main>
      <p className="text-sm"><Link href="/my/requests/new" className="underline">Requests</Link></p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <FormContent params={params} />
      </Suspense>
    </main>
  );
}
