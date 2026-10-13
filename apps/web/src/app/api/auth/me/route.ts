import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roleAssignments.map((r) => ({ role: r.role, siteId: r.siteId, buildingId: r.buildingId })),
  });
}
