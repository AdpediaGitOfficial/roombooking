-- AlterTable
ALTER TABLE "AssetAssignment" ADD COLUMN     "assignedById" TEXT NOT NULL,
ADD COLUMN     "endedById" TEXT,
ADD COLUMN     "facilityId" TEXT,
ADD COLUMN     "notes" TEXT;
-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "description" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "storageLocation" TEXT,
ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'pcs';
-- AlterTable
ALTER TABLE "InventoryTransaction" ADD COLUMN     "balanceAfter" INTEGER,
ADD COLUMN     "condition" "AssetCondition",
ADD COLUMN     "counterpartItemId" TEXT,
ADD COLUMN     "facilityId" TEXT,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "roomId" TEXT,
ADD COLUMN     "staffId" TEXT;
-- CreateIndex
CREATE INDEX "AssetAssignment_staffId_endedAt_idx" ON "AssetAssignment"("staffId", "endedAt");
-- CreateIndex
CREATE INDEX "AssetAssignment_roomId_endedAt_idx" ON "AssetAssignment"("roomId", "endedAt");
-- CreateIndex
CREATE INDEX "AssetAssignment_facilityId_endedAt_idx" ON "AssetAssignment"("facilityId", "endedAt");
-- CreateIndex
CREATE INDEX "InventoryItem_siteId_category_idx" ON "InventoryItem"("siteId", "category");
-- CreateIndex
CREATE INDEX "InventoryItem_siteId_status_trackingType_idx" ON "InventoryItem"("siteId", "status", "trackingType");
-- CreateIndex
CREATE INDEX "InventoryTransaction_createdAt_idx" ON "InventoryTransaction"("createdAt");
-- CreateIndex
CREATE INDEX "InventoryTransaction_staffId_idx" ON "InventoryTransaction"("staffId");
-- CreateIndex
CREATE INDEX "InventoryTransaction_roomId_idx" ON "InventoryTransaction"("roomId");
-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_counterpartItemId_fkey" FOREIGN KEY ("counterpartItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- INV-01: one stock line per SKU per site (serialised assets share a SKU and
-- differ by serial number, which the composite unique already covers).
CREATE UNIQUE INDEX "InventoryItem_stock_sku_unique"
  ON "InventoryItem" ("siteId", "sku")
  WHERE "serialNumber" IS NULL;

-- INV-03: a movement or assignment targets at most one of room, resident, facility.
ALTER TABLE "InventoryTransaction"
  ADD CONSTRAINT "InventoryTransaction_one_target_check"
  CHECK (((("roomId" IS NOT NULL)::int + ("staffId" IS NOT NULL)::int + ("facilityId" IS NOT NULL)::int)) <= 1);
ALTER TABLE "AssetAssignment"
  ADD CONSTRAINT "AssetAssignment_one_target_check"
  CHECK (((("roomId" IS NOT NULL)::int + ("staffId" IS NOT NULL)::int + ("facilityId" IS NOT NULL)::int)) = 1);

-- INV-02: the movement log is permanent.
CREATE OR REPLACE FUNCTION inventory_transaction_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'InventoryTransaction rows cannot be deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "InventoryTransaction_no_delete"
  BEFORE DELETE ON "InventoryTransaction"
  FOR EACH ROW EXECUTE FUNCTION inventory_transaction_no_delete();
