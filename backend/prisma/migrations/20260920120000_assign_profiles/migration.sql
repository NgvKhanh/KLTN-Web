-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "completedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CardMember" ADD COLUMN     "assignedById" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "MemberWorkProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "maxParallelCards" INTEGER NOT NULL DEFAULT 5,
    "pausedUntil" TIMESTAMP(3),
    "allowCrossWorkspace" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberWorkProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceAssignWeights" (
    "workspaceId" TEXT NOT NULL,
    "wExperience" DOUBLE PRECISION NOT NULL DEFAULT 0.45,
    "wReliability" DOUBLE PRECISION NOT NULL DEFAULT 0.30,
    "wAvailability" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "feedbackCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceAssignWeights_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "AssignWeightHistory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "wExperience" DOUBLE PRECISION NOT NULL,
    "wReliability" DOUBLE PRECISION NOT NULL,
    "wAvailability" DOUBLE PRECISION NOT NULL,
    "feedbackCount" INTEGER NOT NULL,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignWeightHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "boardId" TEXT,
    "cardId" TEXT,
    "actorKey" TEXT NOT NULL DEFAULT '',
    "algorithmVersion" TEXT NOT NULL DEFAULT '',
    "weights" JSONB NOT NULL,
    "candidates" JSONB NOT NULL,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "topUserId" TEXT,
    "chosenUserId" TEXT,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "decidedAt" TIMESTAMP(3),
    "learned" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberWorkProfile_workspaceId_idx" ON "MemberWorkProfile"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberWorkProfile_userId_workspaceId_key" ON "MemberWorkProfile"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "AssignWeightHistory_workspaceId_createdAt_idx" ON "AssignWeightHistory"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AssignRun_workspaceId_createdAt_idx" ON "AssignRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AssignRun_accepted_idx" ON "AssignRun"("accepted");

-- CreateIndex
CREATE INDEX "AssignRun_actorKey_idx" ON "AssignRun"("actorKey");

-- CreateIndex
CREATE INDEX "CardMember_userId_createdAt_idx" ON "CardMember"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CardMember" ADD CONSTRAINT "CardMember_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberWorkProfile" ADD CONSTRAINT "MemberWorkProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberWorkProfile" ADD CONSTRAINT "MemberWorkProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAssignWeights" ADD CONSTRAINT "WorkspaceAssignWeights_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignWeightHistory" ADD CONSTRAINT "AssignWeightHistory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "WorkspaceAssignWeights"("workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignRun" ADD CONSTRAINT "AssignRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignRun" ADD CONSTRAINT "AssignRun_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignRun" ADD CONSTRAINT "AssignRun_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===================== LAP DU LIEU CU (backfill) =====================
-- Khong lap thi moi the da xong tu truoc se co completedAt rong, va moi dong
-- CardMember cu se mang moc thoi gian "bay gio" -> lich su gia.

-- 1) completedAt cho the DA xong: lay lan ghi nhat ky card.done GAN NHAT cua
--    chinh the do; khong co nhat ky thi lui ve updatedAt (xap xi, chap nhan duoc).
UPDATE "Card" c
SET "completedAt" = COALESCE(
  (SELECT MAX(a."createdAt") FROM "Activity" a
    WHERE a."cardId" = c."id" AND a."type" = 'card.done'),
  c."updatedAt"
)
WHERE c."isDone" = true AND c."completedAt" IS NULL;

-- 2) Bat bien nguoc lai: the CHUA xong thi khong duoc co completedAt.
UPDATE "Card" SET "completedAt" = NULL WHERE "isDone" = false AND "completedAt" IS NOT NULL;

-- 3) CardMember.createdAt cu: khong the doi chieu voi nhat ky member.add vi
--    nhat ky cu chi luu TEN nguoi, khong luu id. Lay ngay tao the lam xap xi -
--    van dung hon nhieu so voi CURRENT_TIMESTAMP cua cot mac dinh.
UPDATE "CardMember" cm
SET "createdAt" = c."createdAt"
FROM "Card" c
WHERE c."id" = cm."cardId" AND cm."createdAt" > c."createdAt";
