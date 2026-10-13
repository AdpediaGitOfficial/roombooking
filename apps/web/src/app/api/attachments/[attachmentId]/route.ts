import { NextResponse } from "next/server";
import { prisma } from "@sam/core/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { actorOf } from "@/lib/auth/authorize";
import { readStoredFile } from "@sam/core/lib/uploads";
import { accessFor } from "@sam/core/modules/maintenance/service";

/** Serves an uploaded file only to people who may see the record it belongs to. */
export async function GET(_req: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { attachmentId } = await params;
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) return NextResponse.json({ error: "not found" }, { status: 404 });

  let allowed = false;
  if (attachment.entityType === "WorkOrder") {
    const wo = await prisma.workOrder.findUnique({ where: { id: attachment.entityId }, select: { requesterId: true, assigneeId: true, vendorId: true, siteId: true, buildingId: true } });
    allowed = !!wo && accessFor(wo, actorOf(user)) !== null;
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
