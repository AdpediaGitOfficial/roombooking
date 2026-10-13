import "server-only";
import type { ChecklistKind } from "@prisma/client";
import { prisma } from "@sam/core/lib/db";

const DEFAULTS: Record<"CHECK_IN" | "CHECK_OUT", Array<{ id: string; label: string }>> = {
  CHECK_IN: [
    { id: "id", label: "Identity checked" },
    { id: "keys", label: "Keys handed over and signed for" },
    { id: "assets", label: "Room assets walked through with the resident" },
    { id: "rules", label: "House rules explained" },
    { id: "condition", label: "Room condition recorded" },
  ],
  CHECK_OUT: [
    { id: "keys", label: "All keys returned" },
    { id: "assets", label: "Room assets present and in good condition" },
    { id: "condition", label: "Room condition inspected" },
    { id: "belongings", label: "Personal belongings removed" },
    { id: "utilities", label: "Meter and utilities noted" },
  ],
};

/** The checklist to show at check-in or check-out: the organisation's active template, else a sensible default. */
export async function checklistFor(organizationId: string, kind: "CHECK_IN" | "CHECK_OUT", siteId?: string | null) {
  const template = await prisma.checklistTemplate.findFirst({ where: { organizationId, kind: kind as ChecklistKind, active: true, OR: [{ siteId: null }, ...(siteId ? [{ siteId }] : [])] }, orderBy: [{ siteId: "desc" }, { version: "desc" }] });
  const items = Array.isArray(template?.items) ? (template!.items as Array<{ id?: string; label?: string }>).filter((i) => i.id && i.label).map((i) => ({ id: String(i.id), label: String(i.label) })) : [];
  return items.length ? items : DEFAULTS[kind];
}
