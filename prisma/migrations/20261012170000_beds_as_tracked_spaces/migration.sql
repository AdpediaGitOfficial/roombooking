-- Beds become individually tracked spaces; room capacity is derived from
-- beds in service instead of being stored.

-- Rename enum values in place so existing rows keep their meaning:
-- AVAILABLE (in service) -> ACTIVE, INACTIVE (out of capacity) -> RETIRED.
ALTER TYPE "BedStatus" RENAME VALUE 'AVAILABLE' TO 'ACTIVE';
ALTER TYPE "BedStatus" RENAME VALUE 'INACTIVE' TO 'RETIRED';
ALTER TABLE "Bed" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- Reason shown while a bed is blocked (ACM-09).
ALTER TABLE "Bed" ADD COLUMN "blockReason" TEXT;

-- Capacity is now the count of non-retired beds (drops Room_capacity_check too).
ALTER TABLE "Room" DROP COLUMN "capacity";
