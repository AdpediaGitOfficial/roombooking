-- Request submissions history, decision versioning and fulfilment fields (WF-04, WF-05, WF-08).
-- AlterTable
ALTER TABLE "ApprovalDecision" ADD COLUMN     "submissionVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "fulfilmentNote" TEXT,
ADD COLUMN     "submissionVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "RequestSubmission" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestSubmission_requestId_version_key" ON "RequestSubmission"("requestId", "version");

-- AddForeignKey
ALTER TABLE "RequestSubmission" ADD CONSTRAINT "RequestSubmission_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

