// File uploads for photos (MNT-01, LF-01). Files live outside the database
// under UPLOAD_DIR; the Attachment row carries metadata and access is
// checked by the serving route. Content is validated by magic bytes, not by
// the client-supplied type (SRS edge case "Photo upload failure").
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024);
const UPLOAD_DIR = path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? "uploads");

export class UploadError extends Error {}

type Detected = { mimeType: "image/jpeg" | "image/png" | "image/webp"; extension: string };

/** Identifies JPEG, PNG and WebP from their leading bytes; anything else is rejected. */
export function detectImageType(bytes: Uint8Array): Detected | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { mimeType: "image/png", extension: "png" };
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { mimeType: "image/webp", extension: "webp" };
  return null;
}

export function validateImageUpload(bytes: Uint8Array, declaredName: string): Detected {
  if (bytes.length === 0) throw new UploadError("The selected file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError(`Photos must be ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB or smaller.`);
  const detected = detectImageType(bytes);
  if (!detected) throw new UploadError(`"${declaredName || "file"}" is not a JPEG, PNG or WebP image.`);
  return detected;
}

/** Stores an already validated image and records the Attachment row in the caller's transaction. */
export async function storeImage(
  tx: Prisma.TransactionClient,
  input: { bytes: Uint8Array; fileName: string; entityType: string; entityId: string; uploadedById: string },
) {
  const detected = validateImageUpload(input.bytes, input.fileName);
  const storageKey = `${input.entityType.toLowerCase()}/${randomUUID()}.${detected.extension}`;
  const target = path.join(/* turbopackIgnore: true */ UPLOAD_DIR, storageKey);
  await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
  await writeFile(/* turbopackIgnore: true */ target, input.bytes);
  return tx.attachment.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      fileName: input.fileName.slice(0, 200) || `photo.${detected.extension}`,
      mimeType: detected.mimeType,
      sizeBytes: input.bytes.length,
      storageKey,
      uploadedById: input.uploadedById,
    },
  });
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  const target = path.join(/* turbopackIgnore: true */ UPLOAD_DIR, storageKey);
  if (!target.startsWith(UPLOAD_DIR + path.sep)) throw new UploadError("Invalid storage key.");
  return readFile(/* turbopackIgnore: true */ target);
}
