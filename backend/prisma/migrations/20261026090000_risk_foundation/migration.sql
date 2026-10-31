-- Module canh bao nguy co tre han - buoc 1 (RISK_MODULE.md §9). Chi THEM cot / bang moi, khong doi cot cu.
-- ChecklistItem.completedAt: muc da tick TRUOC migration nay giu completedAt = NULL ("khong ro luc nao"), khong bia moc.

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('SAFE', 'WATCH', 'WARNING', 'CRITICAL');

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "riskEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "riskInApp" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "storyPoints" INTEGER;

-- AlterTable
ALTER TABLE "ChecklistItem" ADD COLUMN     "completedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CardRisk" (
    "cardId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "reasons" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "dueDateUsed" TIMESTAMP(3) NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "notifiedLevel" "RiskLevel",
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "CardRisk_pkey" PRIMARY KEY ("cardId")
);

-- CreateTable
CREATE TABLE "CardRiskEvent" (
    "id" TEXT NOT NULL,
    "cardId" TEXT,
    "fromLevel" "RiskLevel",
    "toLevel" "RiskLevel" NOT NULL,
    "score" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "recipients" INTEGER NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardRiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardRisk_level_idx" ON "CardRisk"("level");

-- CreateIndex
CREATE INDEX "CardRiskEvent_cardId_idx" ON "CardRiskEvent"("cardId");

-- CreateIndex
CREATE INDEX "CardRiskEvent_createdAt_idx" ON "CardRiskEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "CardRisk" ADD CONSTRAINT "CardRisk_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

