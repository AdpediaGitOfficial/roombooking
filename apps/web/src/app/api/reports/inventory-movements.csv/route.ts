import { NextResponse } from "next/server";
import type { InventoryTransactionType } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { userCan, userCanAccess } from "@/lib/auth/authorize";
import { csvDownload } from "@/lib/csv-download";
import { sitesFor } from "@/lib/auth/scope";
import { movementCsv } from "@sam/core/modules/inventory/service";

const TYPES = ["RECEIPT", "ISSUE", "RETURN", "TRANSFER", "ADJUSTMENT", "DAMAGE", "RETIREMENT"];
const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!userCan(user, "rep.export") || !userCan(user, "inv.room_assets") && !userCanAccess(user, "inv.room_assets")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const p = new URL(request.url).searchParams;
  const type = p.get("type");
  const csv = await movementCsv({ siteId: await sitesFor(user, "inv.room_assets", p.get("siteId") || null), from: isDate(p.get("from")) ? p.get("from") : null, to: isDate(p.get("to")) ? p.get("to") : null, type: type && TYPES.includes(type) ? (type as InventoryTransactionType) : null, itemId: p.get("itemId") || null }, user.id);
  return csvDownload(user, csv, `inventory-movements-${new Date().toISOString().slice(0, 10)}.csv`);
}
