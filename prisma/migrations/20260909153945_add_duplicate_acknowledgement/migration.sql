-- AlterEnum
ALTER TYPE "ClaimEventType" ADD VALUE 'DUPLICATE_ACKNOWLEDGED';

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "duplicateAcknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "duplicateAcknowledgedById" TEXT;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_duplicateAcknowledgedById_fkey" FOREIGN KEY ("duplicateAcknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
