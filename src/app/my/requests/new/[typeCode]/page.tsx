import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth/authorize";
import { fieldsWithOptions, getCurrentWorkflow, resolveFieldOptions } from "@/modules/requests/service";
import { DynamicForm } from "@/modules/requests/components/dynamic-form";

async function FormContent({ params }: { params: Promise<{ typeCode: string }> }) {
  const { typeCode } = await params;
  const user = await requireUser(`/my/requests/new/${typeCode}`);
  const workflow = await getCurrentWorkflow(user.organizationId, typeCode);
  if (!workflow) notFound();
  const fields = fieldsWithOptions(workflow.schema, await resolveFieldOptions(workflow.schema));
  return (
    <>
      <h1 className="mt-1 text-2xl font-semibold">{workflow.type.name}</h1>
      {workflow.type.description && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{workflow.type.description}</p>}
      {workflow.version.steps.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500">Approval: {workflow.version.steps.map((s) => s.name).join(" → ")}</p>
      )}
      <div className="mt-6">
        <DynamicForm mode="submit" typeCode={workflow.type.code} idempotencyKey={randomUUID()} fields={fields} initialValues={{}} />
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
