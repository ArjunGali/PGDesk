-- Aadhaar moves from a plaintext column to encrypted storage.
--
-- The old `aadhaarNumber` column is DROPPED rather than migrated. Re-encrypting
-- in SQL is not possible (the key lives in the application, not the database),
-- and copying the plaintext into a staging column would leave exactly the
-- exposure this change exists to remove.
--
-- This is safe before first release. If you are applying this to an instance
-- that already holds Aadhaar numbers, export them first and re-enter them
-- afterwards; they will be encrypted on save.
--
-- Replaced by:
--   aadhaarCiphertext  AES-256-GCM, versioned, application-encrypted
--   aadhaarIndex       keyed HMAC, for exact-match search only
--   aadhaarLast4       last four digits, for the masked display form

/*
  Warnings:

  - You are about to drop the column `aadhaarNumber` on the `Tenant` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Tenant_aadhaarNumber_idx";

-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "aadhaarNumber",
ADD COLUMN     "aadhaarCiphertext" TEXT,
ADD COLUMN     "aadhaarIndex" TEXT,
ADD COLUMN     "aadhaarLast4" TEXT;

-- CreateIndex
CREATE INDEX "Tenant_aadhaarIndex_idx" ON "Tenant"("aadhaarIndex");
