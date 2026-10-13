import { prisma } from "./db";

/** An organisation setting (document section 4 "Organization & masters"), or the fallback when unset. */
export async function orgSetting<T>(key: string, fallback: T): Promise<T> {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return fallback;
  const s = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: org.id, key } } });
  return (s?.value as T | undefined) ?? fallback;
}

export async function setOrgSetting(organizationId: string, key: string, value: unknown) {
  const v = value as never;
  return prisma.orgSetting.upsert({ where: { organizationId_key: { organizationId, key } }, update: { value: v }, create: { organizationId, key, value: v } });
}
