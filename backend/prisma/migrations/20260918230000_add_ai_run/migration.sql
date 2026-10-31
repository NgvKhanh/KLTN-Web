-- CreateEnum
CREATE TYPE "AiInputKind" AS ENUM ('TEXT', 'DOCX', 'PDF');

-- CreateEnum
CREATE TYPE "AiPlanMode" AS ENUM ('STRUCTURED', 'FREEFORM');

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "workspaceId" TEXT,
    "boardId" TEXT,
    "actorKey" TEXT NOT NULL DEFAULT '',
    "inputKind" "AiInputKind" NOT NULL DEFAULT 'TEXT',
    "inputText" TEXT NOT NULL,
    "inputChars" INTEGER NOT NULL,
    "inputLines" INTEGER NOT NULL,
    "modeAuto" "AiPlanMode" NOT NULL,
    "mode" "AiPlanMode" NOT NULL,
    "structuredRatio" DOUBLE PRECISION NOT NULL,
    "llmUsed" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "latencyMs" INTEGER,
    "llmFailReason" TEXT,
    "strictParseOk" BOOLEAN NOT NULL DEFAULT false,
    "plan" JSONB NOT NULL,
    "appliedPlan" JSONB,
    "cardCount" INTEGER NOT NULL DEFAULT 0,
    "droppedCards" INTEGER NOT NULL DEFAULT 0,
    "verdictLines" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "editCount" INTEGER,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiRun_actorKey_idx" ON "AiRun"("actorKey");

-- CreateIndex
CREATE INDEX "AiRun_createdAt_idx" ON "AiRun"("createdAt");

-- CreateIndex
CREATE INDEX "AiRun_accepted_idx" ON "AiRun"("accepted");

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

