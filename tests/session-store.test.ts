// Integration test against DATABASE_URL (same database the app uses locally / in CI).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  createSessionRecord,
  hashSessionToken,
  resolveSession,
  revokeSessionByToken,
  revokeUserSessions,
} from "@/lib/auth/session-store";

const EMAIL = "session-test@example.com";
let userId: string;

beforeAll(async () => {
  const org = await prisma.organization.upsert({
    where: { code: "TEST" },
    update: {},
    create: { code: "TEST", name: "Test Org" },
  });
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { status: "ACTIVE" },
    create: { organizationId: org.id, email: EMAIL, name: "Session Test", status: "ACTIVE" },
  });
  userId = user.id;
  await prisma.session.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.$disconnect();
});

describe("session store", () => {
  it("stores only a hash of the token and resolves a valid session", async () => {
    const { token, session } = await createSessionRecord(userId, { userAgent: "vitest" });
    expect(session.tokenHash).toBe(hashSessionToken(token));
    expect(session.tokenHash).not.toContain(token);

    const resolved = await resolveSession(token);
    expect(resolved?.user.id).toBe(userId);
    expect(resolved?.user.roleAssignments).toBeDefined();
  });

  it("returns null for unknown tokens", async () => {
    expect(await resolveSession("not-a-real-token")).toBeNull();
  });

  it("returns null once the session is revoked", async () => {
    const { token } = await createSessionRecord(userId);
    await revokeSessionByToken(token);
    expect(await resolveSession(token)).toBeNull();
  });

  it("returns null once the session has expired", async () => {
    const { token, session } = await createSessionRecord(userId);
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resolveSession(token)).toBeNull();
  });

  it("revokes all sessions for a user and blocks deactivated users", async () => {
    const a = await createSessionRecord(userId);
    const b = await createSessionRecord(userId);
    const count = await revokeUserSessions(userId);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).toBeNull();

    const c = await createSessionRecord(userId);
    await prisma.user.update({ where: { id: userId }, data: { status: "DEACTIVATED" } });
    expect(await resolveSession(c.token)).toBeNull();
    await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
  });
});
