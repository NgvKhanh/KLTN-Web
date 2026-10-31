-- CreateEnum
CREATE TYPE "ChatPlanRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ChatPlanStatus" AS ENUM ('NEEDS_CHOICE', 'PROPOSED', 'EXECUTING', 'EXECUTED', 'FAILED', 'STALE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ChatPlanProvenance" AS ENUM ('USER_DIRECT', 'DELEGATED_TO_DATA', 'UNGROUNDED', 'NOT_REQUESTED');

-- CreateTable
CREATE TABLE "ChatActionPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actorKey" TEXT NOT NULL DEFAULT '',
    "conversationId" TEXT,
    "boardId" TEXT,
    "scopeKind" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "risk" "ChatPlanRisk" NOT NULL,
    "requiresConfirmation" BOOLEAN NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "provenance" "ChatPlanProvenance" NOT NULL,
    "status" "ChatPlanStatus" NOT NULL,
    "autoExecuted" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "adapter" TEXT NOT NULL DEFAULT '',
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "latencyMs" INTEGER,
    "proposedOps" INTEGER NOT NULL DEFAULT 1,
    "executedOps" INTEGER,
    "result" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "ChatActionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatActionPlan_userId_createdAt_idx" ON "ChatActionPlan"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatActionPlan_status_expiresAt_idx" ON "ChatActionPlan"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ChatActionPlan_conversationId_status_idx" ON "ChatActionPlan"("conversationId", "status");

-- CreateIndex
CREATE INDEX "ChatActionPlan_boardId_createdAt_idx" ON "ChatActionPlan"("boardId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatActionPlan" ADD CONSTRAINT "ChatActionPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatActionPlan" ADD CONSTRAINT "ChatActionPlan_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;
