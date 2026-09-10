-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STAFF', 'MANAGER', 'FINANCE');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PARSED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('TRAVEL', 'MEALS', 'SUPPLIES', 'TAXI', 'OTHER');

-- CreateEnum
CREATE TYPE "ReceiptSourceType" AS ENUM ('PASTED_TEXT', 'IMAGE_OCR');

-- CreateEnum
CREATE TYPE "DuplicateMatchType" AS ENUM ('EXACT_HASH', 'FUZZY_TEXT', 'FIELD_MATCH');

-- CreateEnum
CREATE TYPE "ClaimEventType" AS ENUM ('CREATED', 'PARSED', 'EDITED', 'SUBMITTED', 'DUPLICATE_FLAGGED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "managerId" TEXT,
    "monthlyLimit" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "claimantId" TEXT NOT NULL,
    "approverId" TEXT,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PARSED',
    "category" "ExpenseCategory" NOT NULL,
    "merchant" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "expenseDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "rawReceiptText" TEXT NOT NULL,
    "duplicateFlag" BOOLEAN NOT NULL DEFAULT false,
    "duplicateScore" DOUBLE PRECISION,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "sourceType" "ReceiptSourceType" NOT NULL,
    "rawText" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "parsedMerchant" TEXT,
    "parsedDate" DATE,
    "parsedAmount" DECIMAL(10,2),
    "parsedCategory" "ExpenseCategory",
    "parseConfidence" DOUBLE PRECISION,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateMatch" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "matchedClaimId" TEXT NOT NULL,
    "matchType" "DuplicateMatchType" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvent" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "actorId" TEXT,
    "eventType" "ClaimEventType" NOT NULL,
    "fromStatus" "ClaimStatus",
    "toStatus" "ClaimStatus",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Claim_claimantId_idx" ON "Claim"("claimantId");

-- CreateIndex
CREATE INDEX "Claim_approverId_idx" ON "Claim"("approverId");

-- CreateIndex
CREATE INDEX "Claim_status_idx" ON "Claim"("status");

-- CreateIndex
CREATE INDEX "Claim_expenseDate_idx" ON "Claim"("expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_claimId_key" ON "Receipt"("claimId");

-- CreateIndex
CREATE INDEX "Receipt_textHash_idx" ON "Receipt"("textHash");

-- CreateIndex
CREATE INDEX "DuplicateMatch_claimId_idx" ON "DuplicateMatch"("claimId");

-- CreateIndex
CREATE INDEX "DuplicateMatch_matchedClaimId_idx" ON "DuplicateMatch"("matchedClaimId");

-- CreateIndex
CREATE INDEX "ClaimEvent_claimId_idx" ON "ClaimEvent"("claimId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_claimantId_fkey" FOREIGN KEY ("claimantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateMatch" ADD CONSTRAINT "DuplicateMatch_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateMatch" ADD CONSTRAINT "DuplicateMatch_matchedClaimId_fkey" FOREIGN KEY ("matchedClaimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvent" ADD CONSTRAINT "ClaimEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvent" ADD CONSTRAINT "ClaimEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
