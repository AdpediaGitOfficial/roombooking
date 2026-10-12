-- Key register: expected return, non-staff holders, notes and replacement links (KEY-02, KEY-03, KEY-04).
-- AlterTable
ALTER TABLE "Key" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "replacesKeyId" TEXT;

-- AlterTable
ALTER TABLE "KeyTransaction" ADD COLUMN     "expectedReturnAt" TIMESTAMP(3),
ADD COLUMN     "holderName" TEXT;

-- AddForeignKey
ALTER TABLE "Key" ADD CONSTRAINT "Key_replacesKeyId_fkey" FOREIGN KEY ("replacesKeyId") REFERENCES "Key"("id") ON DELETE SET NULL ON UPDATE CASCADE;

