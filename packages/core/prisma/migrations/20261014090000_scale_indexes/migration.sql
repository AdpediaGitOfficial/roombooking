-- CreateIndex
CREATE INDEX "Allocation_status_startDate_idx" ON "Allocation"("status", "startDate" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "FacilityBooking_status_startsAt_idx" ON "FacilityBooking"("status", "startsAt");

-- CreateIndex
CREATE INDEX "KeyTransaction_type_returnedAt_idx" ON "KeyTransaction"("type", "returnedAt");

-- CreateIndex
CREATE INDEX "KeyTransaction_holderId_returnedAt_idx" ON "KeyTransaction"("holderId", "returnedAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_channel_createdAt_idx" ON "Notification"("recipientId", "channel", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "StaffProfile_organizationId_employmentStatus_lastName_idx" ON "StaffProfile"("organizationId", "employmentStatus", "lastName");

-- CreateIndex
CREATE INDEX "User_organizationId_status_idx" ON "User"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_requesterId_createdAt_idx" ON "WorkOrder"("requesterId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WorkOrder_status_createdAt_idx" ON "WorkOrder"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WorkOrderNote_workOrderId_createdAt_idx" ON "WorkOrderNote"("workOrderId", "createdAt");

