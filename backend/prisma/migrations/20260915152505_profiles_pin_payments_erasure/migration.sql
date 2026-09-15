/*
  Warnings:

  - You are about to drop the column `passwordHash` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CASH_AND_UPI';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "attachmentName" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cashAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "status" "PaymentStatus" NOT NULL DEFAULT 'SUBMITTED',
ADD COLUMN     "upiAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "aadhaarNumber" TEXT,
ADD COLUMN     "erasedById" TEXT,
ADD COLUMN     "personalDataErasedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" DROP COLUMN "passwordHash",
ADD COLUMN     "avatarColor" TEXT,
ADD COLUMN     "avatarPath" TEXT,
ADD COLUMN     "failedPinAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "showOnProfileScreen" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "exportedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataExport_tenantId_createdAt_idx" ON "DataExport"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Tenant_aadhaarNumber_idx" ON "Tenant"("aadhaarNumber");

-- AddForeignKey
ALTER TABLE "DataExport" ADD CONSTRAINT "DataExport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExport" ADD CONSTRAINT "DataExport_exportedById_fkey" FOREIGN KEY ("exportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
