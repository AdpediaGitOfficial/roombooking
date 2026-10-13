import { Suspense } from "react";
import { requireCapability } from "@/lib/auth/authorize";
import { ActionForm } from "@/components/forms/action-form";
import { addStaffAction } from "@/modules/people/actions";
import { staffFields } from "@/modules/people/fields";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  await requireCapability("people.add", { returnTo: "/people/new" });
  return (
    <div className="max-w-3xl">
      <ActionForm action={addStaffAction} submit="Add person" fields={[
        { name: "profileType", label: "Profile type", type: "select", options: [{ value: "EMPLOYEE", label: "Employee" }, { value: "CONTRACT_WORKER", label: "Contract worker" }, { value: "GUEST", label: "Guest (fixed end date)" }, { value: "TRAINEE", label: "Trainee (fixed end date)" }] },
        { name: "employeeId", label: "Employee / reference ID", help: "Leave blank for guests and trainees; one is generated." },
        { name: "profileEndDate", label: "Profile end date", type: "date", help: "Required for guests and trainees." },
        ...staffFields,
      ]} />
    </div>
  );
}

export default function NewPersonPage() {
  return (
    <main>
      <PageHeader title="Add person" subtitle="Added profiles stay Unverified until an Accommodation Admin (other than the person who added them) verifies them." crumbs={[["People", "/people"], ["Add"]]} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense>
    </main>
  );
}
