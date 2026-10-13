import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({
    id: user.id,
    username: user.username,
    email: user.email,
    mustChangePassword: user.mustChangePassword,
    name: user.name,
    roles: user.roleAssignments.map((r) => ({ role: r.role, siteId: r.siteId, buildingId: r.buildingId })),
    grants: user.grants.map((g) => ({ capabilitySet: g.capabilitySet, capability: g.capability, siteId: g.siteId, buildingId: g.buildingId, expiresAt: g.expiresAt })),
  });
}
