-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "escalationNote" TEXT,
ADD COLUMN     "expiredAt" TIMESTAMP(3),
ADD COLUMN     "remindedAt" TIMESTAMP(3),
ADD COLUMN     "stepRoleOverride" "Role",
ADD COLUMN     "stepStartedAt" TIMESTAMP(3);
-- AlterTable
ALTER TABLE "RequestType" ADD COLUMN     "escalateAfterDays" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "escalateToRole" "Role",
ADD COLUMN     "expireAfterDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "reminderAfterDays" INTEGER NOT NULL DEFAULT 2;
-- Pending requests that predate the policy clock start it now.
UPDATE "Request" SET "stepStartedAt" = "updatedAt" WHERE "status" = 'PENDING_APPROVAL' AND "stepStartedAt" IS NULL;
-- Seeded and existing types escalate to the accommodation administrator.
UPDATE "RequestType" SET "escalateToRole" = 'ACCOMMODATION_ADMIN' WHERE "escalateToRole" IS NULL;
