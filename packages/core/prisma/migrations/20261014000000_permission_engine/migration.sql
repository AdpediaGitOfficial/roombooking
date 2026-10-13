-- Roles, permissions and module map (phase 1).
-- 1. Custodian and facility-manager accounts become Officers with capability grants.
-- 2. The Role enum is replaced by the document's role set.
-- 3. Username sign-in, temporary passwords, permission grants, maker-checker.

-- ---------------------------------------------------------------------------
-- 1. Fold INVENTORY_KEY_CUSTODIAN and FACILITY_MANAGER into ACCOMMODATION_OFFICER
-- ---------------------------------------------------------------------------
CREATE TABLE "PermissionGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "capabilitySet" TEXT,
    "capability" TEXT,
    "role" TEXT,
    "userId" TEXT,
    "siteId" TEXT,
    "buildingId" TEXT,
    "reason" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PermissionGrant_pkey" PRIMARY KEY ("id")
);

-- Keep the capabilities these accounts had as time-unlimited grants.
INSERT INTO "PermissionGrant" ("id", "organizationId", "capabilitySet", "userId", "siteId", "buildingId", "reason", "grantedById", "createdAt")
SELECT 'mig_' || md5(ra."id" || cs.set), u."organizationId", cs.set, ra."userId", ra."siteId", ra."buildingId",
       'Migrated from the ' || ra."role"::text || ' role', ra."userId", now()
FROM "RoleAssignment" ra
JOIN "User" u ON u."id" = ra."userId"
JOIN LATERAL (
  SELECT unnest(CASE ra."role"::text
    WHEN 'INVENTORY_KEY_CUSTODIAN' THEN ARRAY['KEY_SUPERVISOR', 'INVENTORY_SUPERVISOR']
    WHEN 'FACILITY_MANAGER' THEN ARRAY['FACILITY_MANAGER']
    ELSE ARRAY[]::text[] END) AS set
) cs ON true
WHERE ra."role"::text IN ('INVENTORY_KEY_CUSTODIAN', 'FACILITY_MANAGER');

-- Drop the folded assignments where the user already holds an officer assignment with the same scope.
DELETE FROM "RoleAssignment" ra
WHERE ra."role"::text IN ('INVENTORY_KEY_CUSTODIAN', 'FACILITY_MANAGER')
  AND EXISTS (
    SELECT 1 FROM "RoleAssignment" o
    WHERE o."userId" = ra."userId" AND o."role"::text = 'ACCOMMODATION_OFFICER'
      AND o."siteId" IS NOT DISTINCT FROM ra."siteId" AND o."buildingId" IS NOT DISTINCT FROM ra."buildingId");

-- Two folded assignments with the same scope would collide; keep one.
DELETE FROM "RoleAssignment" a USING "RoleAssignment" b
WHERE a."role"::text IN ('INVENTORY_KEY_CUSTODIAN', 'FACILITY_MANAGER')
  AND b."role"::text IN ('INVENTORY_KEY_CUSTODIAN', 'FACILITY_MANAGER')
  AND a."userId" = b."userId" AND a."id" > b."id"
  AND a."siteId" IS NOT DISTINCT FROM b."siteId" AND a."buildingId" IS NOT DISTINCT FROM b."buildingId";

-- ---------------------------------------------------------------------------
-- 2. Replace the Role enum
-- ---------------------------------------------------------------------------
CREATE TYPE "Role_new" AS ENUM ('SYSTEM_ADMIN', 'ACCOMMODATION_ADMIN', 'ACCOMMODATION_OFFICER', 'STAFF', 'MAINTENANCE_COORDINATOR', 'TECHNICIAN', 'VENDOR', 'SECURITY', 'READONLY_MANAGER', 'AUDITOR', 'LINE_MANAGER');

CREATE FUNCTION pg_temp.map_role(r text) RETURNS text AS $$
  SELECT CASE r
    WHEN 'APPROVER' THEN 'LINE_MANAGER'
    WHEN 'MAINTENANCE' THEN 'TECHNICIAN'
    WHEN 'INVENTORY_KEY_CUSTODIAN' THEN 'ACCOMMODATION_OFFICER'
    WHEN 'FACILITY_MANAGER' THEN 'ACCOMMODATION_OFFICER'
    ELSE r END
$$ LANGUAGE sql IMMUTABLE;

ALTER TABLE "RoleAssignment" ALTER COLUMN "role" TYPE "Role_new" USING pg_temp.map_role("role"::text)::"Role_new";
ALTER TABLE "ApprovalStep" ALTER COLUMN "approverRole" TYPE "Role_new" USING pg_temp.map_role("approverRole"::text)::"Role_new";
ALTER TABLE "Request" ALTER COLUMN "stepRoleOverride" TYPE "Role_new" USING pg_temp.map_role("stepRoleOverride"::text)::"Role_new";
ALTER TABLE "RequestType" ALTER COLUMN "escalateToRole" TYPE "Role_new" USING pg_temp.map_role("escalateToRole"::text)::"Role_new";
ALTER TABLE "ApprovalDelegation" ALTER COLUMN "roles" TYPE "Role_new"[]
  USING string_to_array(trim(both '{}' from replace(replace(replace(replace("roles"::text, 'APPROVER', 'LINE_MANAGER'), 'INVENTORY_KEY_CUSTODIAN', 'ACCOMMODATION_OFFICER'), 'FACILITY_MANAGER', 'ACCOMMODATION_OFFICER'), 'MAINTENANCE', 'TECHNICIAN')), ',')::"Role_new"[];
UPDATE "Broadcast" SET "audience" = replace(replace(replace(replace("audience"::text, '"APPROVER"', '"LINE_MANAGER"'), '"INVENTORY_KEY_CUSTODIAN"', '"ACCOMMODATION_OFFICER"'), '"FACILITY_MANAGER"', '"ACCOMMODATION_OFFICER"'), '"MAINTENANCE"', '"TECHNICIAN"')::jsonb;

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

-- Grants can name a role: switch the placeholder text column to the enum.
ALTER TABLE "PermissionGrant" ALTER COLUMN "role" TYPE "Role" USING "role"::"Role";

-- ---------------------------------------------------------------------------
-- 3. Username sign-in, optional email, temporary passwords
-- ---------------------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN "username" TEXT;
UPDATE "User" SET "username" = lower("email");
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
-- Rows inserted without a username get a placeholder that the trigger below replaces with the lower-cased email.
ALTER TABLE "User" ALTER COLUMN "username" SET DEFAULT (gen_random_uuid())::text;
CREATE FUNCTION user_default_username() RETURNS trigger AS $$
BEGIN
  IF NEW."email" IS NOT NULL AND NEW."username" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    NEW."username" := lower(NEW."email");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "User_default_username" BEFORE INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION user_default_username();
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- ---------------------------------------------------------------------------
-- 4. Grants and maker-checker
-- ---------------------------------------------------------------------------
CREATE INDEX "PermissionGrant_userId_revokedAt_idx" ON "PermissionGrant"("userId", "revokedAt");
CREATE INDEX "PermissionGrant_role_revokedAt_idx" ON "PermissionGrant"("role", "revokedAt");
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_one_capability" CHECK (("capabilitySet" IS NOT NULL)::int + ("capability" IS NOT NULL)::int = 1);
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_one_target" CHECK (("role" IS NOT NULL)::int + ("userId" IS NOT NULL)::int = 1);

CREATE TYPE "ChangeRequestKind" AS ENUM ('ROLE_CHANGE', 'GRANT', 'WORKFLOW_PUBLISH', 'BULK_CHANGE');
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "ChangeRequestKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChangeRequest_organizationId_status_idx" ON "ChangeRequest"("organizationId", "status");
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Maker and checker must be different people.
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_maker_checker" CHECK ("decidedById" IS NULL OR "decidedById" <> "requestedById");
