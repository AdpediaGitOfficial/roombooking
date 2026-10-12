-- Maintenance work orders: note types, internal flag, timing fields and ticket number sequence (MNT-02, MNT-04, MNT-06).
-- CreateEnum
CREATE TYPE "WorkOrderNoteType" AS ENUM ('COMMENT', 'STATUS', 'ASSIGNMENT');

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "locationNote" TEXT,
ADD COLUMN     "reopenCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkOrderNote" ADD COLUMN     "internal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "type" "WorkOrderNoteType" NOT NULL DEFAULT 'COMMENT';


-- Unique, human-readable ticket numbers (MR-<year>-<sequence>).
CREATE SEQUENCE "WorkOrder_ticket_seq" START 1;
