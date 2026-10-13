import { NextResponse } from "next/server";
import type { InventoryTransactionType } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/authorize";
import { INVENTORY_VIEW_ROLES } from "@/modules/inventory/access";
import { movementCsv } from "@/modules/inventory/service";

const TYPES = ["RECEIPT", "ISSUE", "RETURN", "TRANSFER", "ADJUSTMENT", "DAMAGE", "RETIREMENT"];
const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasRole(user, ...INVENTORY_VIEW_ROLES)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const p = new URL(request.url).searchParams;
  const type = p.get("type");
  const csv = await movementCsv({ siteId: p.get("siteId") || null, from: isDate(p.get("from")) ? p.get("from") : null, to: isDate(p.get("to")) ? p.get("to") : null, type: type && TYPES.includes(type) ? (type as InventoryTransactionType) : null, itemId: p.get("itemId") || null }, user.id);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="inventory-movements-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
