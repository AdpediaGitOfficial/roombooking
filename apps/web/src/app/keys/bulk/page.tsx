import { Suspense } from "react";
import { prisma } from "@sam/core/lib/db";
import { requireCapability } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { ActionForm } from "@/components/forms/action-form";
import { bulkKeysAction } from "@/modules/keys/extras-actions";
import { KeyTabs } from "@/modules/keys/components/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("keys.bulk_create", { returnTo: "/keys/bulk" });
  const visible = await visibleSites(user, "keys.bulk_create");
  const [sites, buildings] = await Promise.all([
    prisma.site.findMany({ where: { archivedAt: null, ...(visible ? { id: { in: visible } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.building.findMany({ where: { archivedAt: null, ...(visible ? { siteId: { in: visible } } : {}) }, select: { id: true, name: true, site: { select: { name: true } } }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <KeyTabs user={user} active="bulk" />
      <div className="max-w-xl"><ActionForm action={bulkKeysAction} title="Create keys for rooms" intro="Registers copies for every room in the chosen building (or the whole site). Existing codes are skipped." submit="Create keys" fields={[
        { name: "siteId", label: "Site", type: "select", options: sites.map((s) => ({ value: s.id, label: s.name })) },
        { name: "buildingId", label: "Building", type: "select", options: [{ value: "", label: "Whole site" }, ...buildings.map((b) => ({ value: b.id, label: `${b.site.name} · ${b.name}` }))] },
        { name: "copies", label: "Copies per room", type: "number", min: 1, max: 10, defaultValue: 2 },
        { name: "prefix", label: "Code prefix (optional)" },
      ]} /></div>
    </>
  );
}

export default function BulkKeysPage() {
  return <main><PageHeader title="Bulk key creation" subtitle="Copies per room, generated from the property structure." crumbs={[["Keys", "/keys"], ["Bulk create"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
