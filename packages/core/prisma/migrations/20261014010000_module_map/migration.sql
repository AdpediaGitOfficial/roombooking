-- CreateEnum
CREATE TYPE "BedReadiness" AS ENUM ('READY', 'NEEDS_CLEANING', 'INSPECTING');

-- CreateEnum
CREATE TYPE "StaffProfileType" AS ENUM ('EMPLOYEE', 'CONTRACT_WORKER', 'GUEST', 'TRAINEE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "StaffSource" AS ENUM ('HRMS', 'CSV', 'MANUAL');

-- CreateEnum
CREATE TYPE "VendorState" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "StayType" AS ENUM ('PERMANENT', 'TEMPORARY', 'VISITING', 'TRAINING', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "WorkOrderSource" AS ENUM ('RESIDENT', 'OFFICER', 'SECURITY', 'INSPECTION', 'PREVENTIVE', 'COORDINATOR');

-- CreateEnum
CREATE TYPE "CostApprovalStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MasterKind" AS ENUM ('PROPERTY_TYPE', 'ROOM_TYPE', 'BED_TYPE', 'AMENITY', 'ELIGIBILITY_CATEGORY', 'DEPARTMENT', 'GRADE', 'REQUEST_CATEGORY', 'MAINTENANCE_CATEGORY', 'INCIDENT_CATEGORY', 'STORE', 'GATE', 'KEY_CABINET', 'PATROL_CHECKPOINT', 'VISITOR_POLICY', 'HOLIDAY', 'CHARGE_CATEGORY');

-- CreateEnum
CREATE TYPE "ChecklistKind" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'INSPECTION', 'CLEANING');

-- CreateEnum
CREATE TYPE "DependentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JoinerStatus" AS ENUM ('EXPECTED', 'ALLOCATED', 'ARRIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExitStatus" AS ENUM ('OPEN', 'CHECKOUT_DUE', 'CLEARING', 'CLEARED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'OFFERED', 'ALLOCATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MoveTaskStatus" AS ENUM ('OPEN', 'DONE');

-- CreateEnum
CREATE TYPE "CleaningStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CleaningReason" AS ENUM ('CHECKOUT', 'PERIODIC', 'ADHOC', 'INSPECTION');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('SCHEDULED', 'DONE', 'ISSUES_FOUND', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PermitStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CLOSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VendorDocumentKind" AS ENUM ('TRADE_LICENCE', 'INSURANCE', 'CONTRACT', 'ID_VERIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractorWorkerStatus" AS ENUM ('PENDING', 'VERIFIED', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ContractorVisitStatus" AS ENUM ('SCHEDULED', 'PASS_ISSUED', 'CHECKED_IN', 'CHECKED_OUT', 'DENIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "KeyLossStatus" AS ENUM ('REPORTED', 'APPROVED', 'REJECTED', 'LOCK_CHANGE_ORDERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "KeyAuditStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "WriteOffStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FacilityBlockType" AS ENUM ('BLOCK', 'EVENT', 'RECURRING');

-- CreateEnum
CREATE TYPE "BookingWaitStatus" AS ENUM ('WAITING', 'OFFERED', 'CONFIRMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VisitorKind" AS ENUM ('DAY', 'OVERNIGHT', 'RESTRICTED_AREA', 'WALK_IN');

-- CreateEnum
CREATE TYPE "VisitorStatus" AS ENUM ('PRE_REGISTERED', 'PENDING_APPROVAL', 'APPROVED', 'WALK_IN_PENDING', 'CHECKED_IN', 'CHECKED_OUT', 'DENIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'ACTION_TAKEN', 'CLOSED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "ParcelStatus" AS ENUM ('RECEIVED', 'NOTIFIED', 'COLLECTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "SosStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM');

-- CreateEnum
CREATE TYPE "RateKind" AS ENUM ('ROOM_RENT', 'FACILITY_FEE', 'DAMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPORTED', 'WAIVED');

-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AlertComparison" AS ENUM ('ABOVE', 'BELOW');

-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('HRMS', 'SSO', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "RetentionAction" AS ENUM ('ARCHIVE', 'ANONYMISE', 'DELETE');

-- CreateEnum
CREATE TYPE "DataRequestKind" AS ENUM ('ACCESS', 'CORRECTION', 'ERASURE');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('REQUESTED', 'COMPLIANCE_APPROVED', 'REJECTED', 'COMPLETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BedStatus" ADD VALUE 'DRAFT';
ALTER TYPE "BedStatus" ADD VALUE 'MAINTENANCE';
ALTER TYPE "BedStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RecordStatus" ADD VALUE 'DRAFT';
ALTER TYPE "RecordStatus" ADD VALUE 'MAINTENANCE';
ALTER TYPE "RecordStatus" ADD VALUE 'BLOCKED';
ALTER TYPE "RecordStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RoomStatus" ADD VALUE 'DRAFT';
ALTER TYPE "RoomStatus" ADD VALUE 'MAINTENANCE';
ALTER TYPE "RoomStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkOrderStatus" ADD VALUE 'ACCEPTED';
ALTER TYPE "WorkOrderStatus" ADD VALUE 'ON_HOLD';
ALTER TYPE "WorkOrderStatus" ADD VALUE 'VERIFIED';

-- AlterTable
ALTER TABLE "Allocation" ADD COLUMN     "provisional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "provisionalApproveBy" TIMESTAMP(3),
ADD COLUMN     "provisionalApprovedAt" TIMESTAMP(3),
ADD COLUMN     "provisionalApprovedById" TEXT,
ADD COLUMN     "stayType" "StayType" NOT NULL DEFAULT 'PERMANENT';

-- AlterTable
ALTER TABLE "Bed" ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "bedType" TEXT,
ADD COLUMN     "blockedUntil" TIMESTAMP(3),
ADD COLUMN     "readiness" "BedReadiness" NOT NULL DEFAULT 'READY',
ADD COLUMN     "readinessUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Building" ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "eligibility" JSONB,
ADD COLUMN     "genderPolicy" "GenderPolicy";

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "eligibility" JSONB,
ADD COLUMN     "feePerHour" DECIMAL(10,2),
ADD COLUMN     "noShowLimit" INTEGER;

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "store" TEXT,
ADD COLUMN     "unitValue" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Key" ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "cabinet" TEXT,
ADD COLUMN     "lockRef" TEXT,
ADD COLUMN     "sensitive" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "amenities" TEXT[],
ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "areaSqm" DECIMAL(8,2),
ADD COLUMN     "attachedBath" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "eligibility" JSONB,
ADD COLUMN     "floorId" TEXT,
ADD COLUMN     "inheritsPolicy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "monthlyCharge" DECIMAL(10,2),
ADD COLUMN     "unitId" TEXT;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "defaultEligibility" JSONB,
ADD COLUMN     "genderPolicy" "GenderPolicy",
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "propertyType" TEXT;

-- AlterTable
ALTER TABLE "StaffProfile" ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "designation" TEXT,
ADD COLUMN     "eligibilityCategory" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "entitlement" JSONB,
ADD COLUMN     "grade" TEXT,
ADD COLUMN     "hrmsId" TEXT,
ADD COLUMN     "idNumber" TEXT,
ADD COLUMN     "idType" TEXT,
ADD COLUMN     "joiningDate" DATE,
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "photoAttachmentId" TEXT,
ADD COLUMN     "profileEndDate" DATE,
ADD COLUMN     "profileType" "StaffProfileType" NOT NULL DEFAULT 'EMPLOYEE',
ADD COLUMN     "source" "StaffSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'VERIFIED',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "consentAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "consentVersion" TEXT,
ADD COLUMN     "languagePreference" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "contractEnd" DATE,
ADD COLUMN     "contractStart" DATE,
ADD COLUMN     "rating" DECIMAL(3,2),
ADD COLUMN     "state" "VendorState" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "stateReason" TEXT,
ADD COLUMN     "tradeCategories" TEXT[];

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "autoCloseAt" TIMESTAMP(3),
ADD COLUMN     "blockedBedId" TEXT,
ADD COLUMN     "costActual" DECIMAL(12,2),
ADD COLUMN     "costApprovalStatus" "CostApprovalStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "costApprovedAt" TIMESTAMP(3),
ADD COLUMN     "costApprovedById" TEXT,
ADD COLUMN     "costEstimate" DECIMAL(12,2),
ADD COLUMN     "costNote" TEXT,
ADD COLUMN     "holdReason" TEXT,
ADD COLUMN     "inspectionId" TEXT,
ADD COLUMN     "invoiceRef" TEXT,
ADD COLUMN     "laborHours" DECIMAL(6,2),
ADD COLUMN     "needsPermit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preventiveScheduleId" TEXT,
ADD COLUMN     "quoteRef" TEXT,
ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "ratingNote" TEXT,
ADD COLUMN     "rootCause" TEXT,
ADD COLUMN     "source" "WorkOrderSource" NOT NULL DEFAULT 'RESIDENT',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT,
ADD COLUMN     "visitEnd" TIMESTAMP(3),
ADD COLUMN     "visitStart" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Floor" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "archiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Floor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floorId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "archiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "kind" "MasterKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "archiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "ChecklistKind" NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "siteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseRuleAcknowledgement" (
    "id" TEXT NOT NULL,
    "houseRuleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseRuleAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'count',
    "higherIsBetter" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiTarget" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "siteId" TEXT,
    "target" DECIMAL(14,4) NOT NULL,
    "setById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dependent" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "idNumber" TEXT,
    "status" "DependentStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "verifiedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dependent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Joiner" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "siteId" TEXT,
    "expectedArrival" DATE NOT NULL,
    "stayType" "StayType" NOT NULL DEFAULT 'PERMANENT',
    "status" "JoinerStatus" NOT NULL DEFAULT 'EXPECTED',
    "allocationId" TEXT,
    "notes" TEXT,
    "source" "StaffSource" NOT NULL DEFAULT 'MANUAL',
    "raisedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Joiner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitCase" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "triggeredById" TEXT,
    "source" "StaffSource" NOT NULL DEFAULT 'MANUAL',
    "lastDay" DATE NOT NULL,
    "status" "ExitStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "clearedAt" TIMESTAMP(3),
    "clearedById" TEXT,
    "clearanceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExitCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "siteId" TEXT,
    "roomType" TEXT,
    "neededFrom" DATE NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "notes" TEXT,
    "offeredBedId" TEXT,
    "allocationId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveTask" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "MoveTaskStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,

    CONSTRAINT "MoveTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftLog" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "summary" JSONB,
    "notes" TEXT,

    CONSTRAINT "ShiftLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleaningTask" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "roomId" TEXT,
    "bedId" TEXT,
    "reason" "CleaningReason" NOT NULL DEFAULT 'CHECKOUT',
    "status" "CleaningStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CleaningTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "templateId" TEXT,
    "scheduleId" TEXT,
    "scheduledFor" DATE NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "performedById" TEXT,
    "performedAt" TIMESTAMP(3),
    "results" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionSchedule" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "buildingId" TEXT,
    "roomId" TEXT,
    "templateId" TEXT,
    "title" TEXT NOT NULL,
    "frequencyDays" INTEGER NOT NULL,
    "nextDueAt" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderPart" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "itemId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCost" DECIMAL(12,2),
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPermit" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "hazards" TEXT,
    "controls" TEXT,
    "status" "PermitStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkPermit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreventiveSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "buildingId" TEXT,
    "roomId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" "WorkOrderPriority" NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT,
    "frequencyDays" INTEGER NOT NULL,
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "assigneeId" TEXT,
    "vendorId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastGeneratedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreventiveSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorDocument" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "kind" "VendorDocumentKind" NOT NULL,
    "reference" TEXT,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "attachmentId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorRate" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'hour',
    "rate" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "validFrom" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorWorker" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "idType" TEXT,
    "idNumber" TEXT,
    "phone" TEXT,
    "policeVerified" BOOLEAN NOT NULL DEFAULT false,
    "status" "ContractorWorkerStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "isSupervisor" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorVisit" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "vendorId" TEXT NOT NULL,
    "workerIds" TEXT[],
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "status" "ContractorVisitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "passCode" TEXT,
    "escortRequired" BOOLEAN NOT NULL DEFAULT false,
    "deniedReason" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "checkedInById" TEXT,
    "checkedOutAt" TIMESTAMP(3),
    "checkedOutById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyLossCase" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "note" TEXT,
    "status" "KeyLossStatus" NOT NULL DEFAULT 'REPORTED',
    "approvedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "workOrderId" TEXT,
    "replacementKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyLossCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyAudit" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "status" "KeyAuditStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "expected" JSONB NOT NULL,
    "counted" JSONB,
    "variances" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,

    CONSTRAINT "KeyAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryWriteOff" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "WriteOffStatus" NOT NULL DEFAULT 'PENDING',
    "recordedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "needsSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryWriteOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityStrike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "facilityId" TEXT,
    "bookingId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "liftedById" TEXT,
    "liftedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityStrike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityClosure" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "workOrderId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "FacilityClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityBlock" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "type" "FacilityBlockType" NOT NULL DEFAULT 'BLOCK',
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "recurrence" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "FacilityBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingWaitlist" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "status" "BookingWaitStatus" NOT NULL DEFAULT 'WAITING',
    "offeredAt" TIMESTAMP(3),
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingWaitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "kind" "VisitorKind" NOT NULL DEFAULT 'DAY',
    "status" "VisitorStatus" NOT NULL DEFAULT 'PRE_REGISTERED',
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "idType" TEXT,
    "idNumber" TEXT,
    "company" TEXT,
    "purpose" TEXT,
    "hostStaffId" TEXT,
    "hostUserId" TEXT,
    "registeredById" TEXT,
    "expectedAt" TIMESTAMP(3),
    "expectedOutAt" TIMESTAMP(3),
    "nights" INTEGER,
    "restrictedArea" TEXT,
    "vehicle" TEXT,
    "gate" TEXT,
    "passCode" TEXT,
    "approvedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "deniedReason" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "checkedInById" TEXT,
    "checkedOutAt" TIMESTAMP(3),
    "checkedOutById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "IncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "description" TEXT NOT NULL,
    "location" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedById" TEXT NOT NULL,
    "involvedStaffId" TEXT,
    "actionTaken" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closureNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentUpdate" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "status" "IncidentStatus",
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parcel" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "staffId" TEXT,
    "recipientName" TEXT,
    "carrier" TEXT,
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "collectedByName" TEXT,
    "collectedById" TEXT,
    "status" "ParcelStatus" NOT NULL DEFAULT 'RECEIVED',
    "notes" TEXT,

    CONSTRAINT "Parcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SosAlert" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "raisedByRole" "Role",
    "location" TEXT,
    "note" TEXT,
    "status" "SosStatus" NOT NULL DEFAULT 'ACTIVE',
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SosAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatrolRound" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "PatrolRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatrolScan" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "checkpointCode" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "PatrolScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestrictedEntry" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "name" TEXT NOT NULL,
    "idNumber" TEXT,
    "reason" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removalRequestedById" TEXT,
    "removalRequestedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removalNote" TEXT,

    CONSTRAINT "RestrictedEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "kind" "RateKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "siteId" TEXT,
    "kind" "RateKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "raisedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "exportBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeExportBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargeExportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplateOverride" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplateOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "filters" JSONB,
    "frequency" "ScheduleFrequency" NOT NULL DEFAULT 'WEEKLY',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kpiKey" TEXT NOT NULL,
    "comparison" "AlertComparison" NOT NULL,
    "threshold" DECIMAL(14,4) NOT NULL,
    "siteId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "trigger" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastStatus" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" INTEGER,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "retainDays" INTEGER NOT NULL,
    "action" "RetentionAction" NOT NULL DEFAULT 'ARCHIVE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "DataRequestKind" NOT NULL,
    "detail" TEXT,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Floor_buildingId_code_key" ON "Floor"("buildingId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_buildingId_code_key" ON "Unit"("buildingId", "code");

-- CreateIndex
CREATE INDEX "MasterItem_organizationId_kind_status_idx" ON "MasterItem"("organizationId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MasterItem_organizationId_kind_code_siteId_key" ON "MasterItem"("organizationId", "kind", "code", "siteId");

-- CreateIndex
CREATE INDEX "ChecklistTemplate_organizationId_kind_active_idx" ON "ChecklistTemplate"("organizationId", "kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "HouseRule_organizationId_code_version_key" ON "HouseRule"("organizationId", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "HouseRuleAcknowledgement_houseRuleId_userId_key" ON "HouseRuleAcknowledgement"("houseRuleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgSetting_organizationId_key_key" ON "OrgSetting"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "KpiDefinition_organizationId_key_key" ON "KpiDefinition"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "KpiTarget_kpiId_siteId_key" ON "KpiTarget"("kpiId", "siteId");

-- CreateIndex
CREATE INDEX "Dependent_staffId_idx" ON "Dependent"("staffId");

-- CreateIndex
CREATE INDEX "Joiner_status_expectedArrival_idx" ON "Joiner"("status", "expectedArrival");

-- CreateIndex
CREATE INDEX "ExitCase_status_lastDay_idx" ON "ExitCase"("status", "lastDay");

-- CreateIndex
CREATE INDEX "WaitlistEntry_status_neededFrom_idx" ON "WaitlistEntry"("status", "neededFrom");

-- CreateIndex
CREATE INDEX "ShiftLog_siteId_startedAt_idx" ON "ShiftLog"("siteId", "startedAt");

-- CreateIndex
CREATE INDEX "CleaningTask_siteId_status_idx" ON "CleaningTask"("siteId", "status");

-- CreateIndex
CREATE INDEX "Inspection_siteId_status_scheduledFor_idx" ON "Inspection"("siteId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "WorkOrderPart_workOrderId_idx" ON "WorkOrderPart"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkPermit_workOrderId_status_idx" ON "WorkPermit"("workOrderId", "status");

-- CreateIndex
CREATE INDEX "PreventiveSchedule_active_nextDueAt_idx" ON "PreventiveSchedule"("active", "nextDueAt");

-- CreateIndex
CREATE INDEX "VendorDocument_vendorId_expiresAt_idx" ON "VendorDocument"("vendorId", "expiresAt");

-- CreateIndex
CREATE INDEX "VendorRate_vendorId_category_idx" ON "VendorRate"("vendorId", "category");

-- CreateIndex
CREATE INDEX "ContractorWorker_vendorId_status_idx" ON "ContractorWorker"("vendorId", "status");

-- CreateIndex
CREATE INDEX "ContractorVisit_siteId_status_scheduledStart_idx" ON "ContractorVisit"("siteId", "status", "scheduledStart");

-- CreateIndex
CREATE INDEX "KeyLossCase_keyId_status_idx" ON "KeyLossCase"("keyId", "status");

-- CreateIndex
CREATE INDEX "InventoryWriteOff_status_idx" ON "InventoryWriteOff"("status");

-- CreateIndex
CREATE INDEX "FacilityStrike_userId_active_idx" ON "FacilityStrike"("userId", "active");

-- CreateIndex
CREATE INDEX "FacilityClosure_facilityId_startsAt_idx" ON "FacilityClosure"("facilityId", "startsAt");

-- CreateIndex
CREATE INDEX "FacilityBlock_facilityId_startsAt_idx" ON "FacilityBlock"("facilityId", "startsAt");

-- CreateIndex
CREATE INDEX "BookingWaitlist_facilityId_status_startsAt_idx" ON "BookingWaitlist"("facilityId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Visitor_siteId_status_expectedAt_idx" ON "Visitor"("siteId", "status", "expectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_reference_key" ON "Incident"("reference");

-- CreateIndex
CREATE INDEX "Incident_siteId_status_idx" ON "Incident"("siteId", "status");

-- CreateIndex
CREATE INDEX "Parcel_siteId_status_idx" ON "Parcel"("siteId", "status");

-- CreateIndex
CREATE INDEX "SosAlert_siteId_status_idx" ON "SosAlert"("siteId", "status");

-- CreateIndex
CREATE INDEX "PatrolRound_siteId_startedAt_idx" ON "PatrolRound"("siteId", "startedAt");

-- CreateIndex
CREATE INDEX "RestrictedEntry_siteId_removedAt_idx" ON "RestrictedEntry"("siteId", "removedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rate_organizationId_kind_code_siteId_key" ON "Rate"("organizationId", "kind", "code", "siteId");

-- CreateIndex
CREATE INDEX "Charge_staffId_status_idx" ON "Charge"("staffId", "status");

-- CreateIndex
CREATE INDEX "Charge_status_idx" ON "Charge"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplateOverride_organizationId_event_channel_key" ON "NotificationTemplateOverride"("organizationId", "event", "channel");

-- CreateIndex
CREATE INDEX "ReportSubscription_active_nextRunAt_idx" ON "ReportSubscription"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "ReportAlert_active_idx" ON "ReportAlert"("active");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConfig_organizationId_kind_key" ON "IntegrationConfig"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "SyncRun_integrationId_startedAt_idx" ON "SyncRun"("integrationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_tokenHash_key" ON "ApiKey"("tokenHash");

-- CreateIndex
CREATE INDEX "WebhookDelivery_deliveredAt_nextAttemptAt_idx" ON "WebhookDelivery"("deliveredAt", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_organizationId_recordType_key" ON "RetentionPolicy"("organizationId", "recordType");

-- CreateIndex
CREATE INDEX "DataRequest_status_idx" ON "DataRequest"("status");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseRuleAcknowledgement" ADD CONSTRAINT "HouseRuleAcknowledgement_houseRuleId_fkey" FOREIGN KEY ("houseRuleId") REFERENCES "HouseRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiTarget" ADD CONSTRAINT "KpiTarget_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "KpiDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dependent" ADD CONSTRAINT "Dependent_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Joiner" ADD CONSTRAINT "Joiner_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitCase" ADD CONSTRAINT "ExitCase_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatrolScan" ADD CONSTRAINT "PatrolScan_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PatrolRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written additions
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS incident_reference_seq START 1;

-- A restricted-entry removal must be approved by someone other than the person who asked for it.
ALTER TABLE "RestrictedEntry" ADD CONSTRAINT "RestrictedEntry_removal_checker" CHECK ("removedById" IS NULL OR "removalRequestedById" IS NULL OR "removedById" <> "removalRequestedById");
-- A charge cannot be approved by the person who raised it (recorder is not the approver).
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_maker_checker" CHECK ("decidedById" IS NULL OR "decidedById" <> "raisedById");
-- Stock write-offs: the recorder is not the approver.
ALTER TABLE "InventoryWriteOff" ADD CONSTRAINT "InventoryWriteOff_maker_checker" CHECK ("decidedById" IS NULL OR "decidedById" <> "recordedById");
-- Work permit approvals and cost approvals are separate from the requester too.
ALTER TABLE "WorkPermit" ADD CONSTRAINT "WorkPermit_maker_checker" CHECK ("approvedById" IS NULL OR "approvedById" <> "requestedById");
