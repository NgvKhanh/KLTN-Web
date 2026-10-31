-- AlterTable
ALTER TABLE "ChatActionPlan" ADD COLUMN     "executionMs" INTEGER,
ADD COLUMN     "executionStartedAt" TIMESTAMP(3),
ADD COLUMN     "executionSuccess" BOOLEAN,
ADD COLUMN     "failureCategory" TEXT,
ADD COLUMN     "opTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "parseSuccess" BOOLEAN,
ADD COLUMN     "resolveSuccess" BOOLEAN;

