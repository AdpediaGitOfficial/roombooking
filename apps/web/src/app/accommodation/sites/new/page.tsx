import { Suspense } from "react";
import { requireCapability } from "@/lib/auth/authorize";
import { SiteForm } from "@/modules/structure/components/forms";
import { masterOptions } from "@/modules/structure/context";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("setup.sites", { returnTo: "/accommodation/sites/new" });
  return <SiteForm propertyTypes={await masterOptions(user.organizationId, "PROPERTY_TYPE")} />;
}

export default function NewSitePage() {
  return (
    <main className="max-w-3xl">
      <PageHeader title="New site" subtitle="Sites start as drafts. Add buildings and rooms, then review and activate." crumbs={[["Accommodation", "/accommodation"], ["New site"]]} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense>
    </main>
  );
}
