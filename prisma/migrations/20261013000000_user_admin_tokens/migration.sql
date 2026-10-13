-- Invite and password-reset tokens for user administration (ADM-01, SS-08).
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "tokenHash" TEXT,
ADD COLUMN     "tokenPurpose" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_tokenHash_key" ON "User"("tokenHash");

