import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { readStoredFile } from "@/lib/uploads";
import { accessFor } from "@/modules/maintenance/service";

/** Serves an uploaded file only to people who may see the record it belongs to. */
export async function GET(_req: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { attachmentId } = await params;
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) return NextResponse.json({ error: "not found" }, { status: 404 });

  let allowed = false;
  if (attachment.entityType === "WorkOrder") {
    const wo = await prisma.workOrder.findUnique({ where: { id: attachment.entityId }, select: { requesterId: true, assigneeId: true, vendorId: true } });
    allowed = !!wo && accessFor(wo, { id: user.id, roles: user.roleAssignments.map((r) => r.role), vendorId: user.vendorId }) !== null;
  }
  if (attachment.entityType === "LostFoundItem") {
    // Photos of found items are visible to every signed-in user (residents browse them to find their things).
    allowed = !!(await prisma.lostFoundItem.findUnique({ where: { id: attachment.entityId }, select: { id: true } }));
  }
  if (!allowed) return NextResponse.json({ error: "not found" }, { status: 404 });

  const bytes = await readStoredFile(attachment.storageKey);
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": attachment.mimeType, "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=300", "Content-Disposition": `inline; filename="${attachment.fileName.replace(/"/g, "")}"` },
  });
}
