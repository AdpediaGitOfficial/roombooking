// Serving uploaded files only to people who may see the record they belong to.
import { prisma } from "../../lib/db";
import { readStoredFile } from "../../lib/uploads";
import { MaintenanceError } from "../maintenance/errors";
import { accessFor, type Actor } from "../maintenance/rules";

export async function readAttachment(actor: Actor, attachmentId: string) {
  const notFound = () => new MaintenanceError("NOT_FOUND", "File not found.");
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) throw notFound();

  let allowed = false;
  if (attachment.entityType === "WorkOrder") {
    const wo = await prisma.workOrder.findUnique({ where: { id: attachment.entityId }, select: { requesterId: true, assigneeId: true, vendorId: true } });
    allowed = !!wo && accessFor(wo, actor) !== null;
  } else if (attachment.entityType === "LostFoundItem") {
    // Photos of found items are visible to every signed-in user (residents browse them to find their things).
    allowed = !!(await prisma.lostFoundItem.findUnique({ where: { id: attachment.entityId }, select: { id: true } }));
  }
  if (!allowed) throw notFound();

  return { body: new Uint8Array(await readStoredFile(attachment.storageKey)), contentType: attachment.mimeType, fileName: attachment.fileName };
}
