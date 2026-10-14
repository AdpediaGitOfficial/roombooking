import { NextResponse } from "next/server";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";

/** Streams an uploaded photo from the API to the browser; the API decides who may see it. */
export async function GET(_req: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { attachmentId } = await params;
  try {
    const file = await api.files.attachment({ id: attachmentId });
    return new NextResponse(file.body as BodyInit, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.body.length),
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `inline; filename="${(file.fileName ?? "file").replace(/"/g, "")}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return NextResponse.json({ error: "not found" }, { status: 404 });
    throw error;
  }
}
