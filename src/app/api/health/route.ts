import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "up" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json(
      { status: "degraded", database: "down", error: message },
      { status: 503 },
    );
  }
}
