// Creates sessions for the generated residents and the demo staff accounts and
// writes the bearer tokens to scripts/loadtest/tokens.json (git-ignored), so the
// simulation does not pay for password hashing. Run: npm run loadtest:tokens
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "@sam/core/lib/db";
import { createSessionRecord } from "@sam/core/lib/auth/session-store";

const OUT = fileURLToPath(new URL("./tokens.json", import.meta.url));

const residents = await prisma.user.findMany({ where: { email: { startsWith: "load" } }, select: { id: true }, orderBy: { email: "asc" }, take: 600 });
const staffEmails = ["admin@example.com", "officer@example.com", "manager@example.com", "custodian@example.com", "engineer@example.com", "facility@example.com"];
const staff = await prisma.user.findMany({ where: { email: { in: staffEmails } }, select: { id: true, email: true } });
const out = { residents: [] as string[], ops: [] as Array<{ email: string; token: string }> };
for (const r of residents) out.residents.push((await createSessionRecord(r.id)).token);
for (const s of staff) out.ops.push({ email: s.email, token: (await createSessionRecord(s.id)).token });
writeFileSync(OUT, JSON.stringify(out));
console.log(out.residents.length, "resident sessions;", out.ops.length, "ops sessions ->", OUT);
await prisma.$disconnect();
