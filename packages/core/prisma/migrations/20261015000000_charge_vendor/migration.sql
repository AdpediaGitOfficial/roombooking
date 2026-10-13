-- A charge can be raised against a vendor (for example a contractor who loses a key), not only a resident.
ALTER TABLE "Charge" ALTER COLUMN "staffId" DROP NOT NULL;
ALTER TABLE "Charge" ADD COLUMN "vendorId" TEXT;
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_one_payer" CHECK (("staffId" IS NOT NULL) <> ("vendorId" IS NOT NULL));
CREATE INDEX "Charge_vendorId_status_idx" ON "Charge"("vendorId", "status");
ALTER TABLE "KeyTransaction" ADD COLUMN "holderVendorId" TEXT;
