-- Site office contact details and resident emergency contacts (SS-02, SS-03).
-- AlterTable
ALTER TABLE "StaffProfile" ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "helpNotes" TEXT;

