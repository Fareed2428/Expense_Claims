-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "parseWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[];
