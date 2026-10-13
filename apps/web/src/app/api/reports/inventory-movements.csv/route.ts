import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { apiFailure, fileResponse } from "@/lib/file-response";
import { getCurrentUser } from "@/lib/auth/session";

const TYPES = ["RECEIPT", "ISSUE", "RETURN", "TRANSFER", "ADJUSTMENT", "DAMAGE", "RETIREMENT"] as const;
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(request: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const p = new URL(request.url).searchParams;
  const type = p.get("type");
  try {
    const file = await api.inventory.movementsCsv({
      siteId: p.get("siteId") || undefined,
      from: isDate(p.get("from")) ? p.get("from")! : undefined,
      to: isDate(p.get("to")) ? p.get("to")! : undefined,
      type: TYPES.find((t) => t === type),
      itemId: p.get("itemId") || undefined,
    });
    return fileResponse(file);
  } catch (error) {
    return apiFailure(error);
  }
}
