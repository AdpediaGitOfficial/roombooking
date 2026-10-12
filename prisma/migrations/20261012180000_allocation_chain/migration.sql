-- Allocation history chain, notes and creator (ACM-07, ACM-08).
-- AlterTable
ALTER TABLE "Allocation" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "previousAllocationId" TEXT;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_previousAllocationId_fkey" FOREIGN KEY ("previousAllocationId") REFERENCES "Allocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

