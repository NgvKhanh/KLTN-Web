-- CreateTable
CREATE TABLE "BoardTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardTemplateList" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BoardTemplateList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardTemplateCard" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BoardTemplateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardTemplate" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardTemplateChecklist" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CardTemplateChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardTemplateItem" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CardTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardTemplate_workspaceId_idx" ON "BoardTemplate"("workspaceId");

-- CreateIndex
CREATE INDEX "BoardTemplateList_templateId_idx" ON "BoardTemplateList"("templateId");

-- CreateIndex
CREATE INDEX "BoardTemplateCard_listId_idx" ON "BoardTemplateCard"("listId");

-- CreateIndex
CREATE INDEX "CardTemplate_boardId_idx" ON "CardTemplate"("boardId");

-- CreateIndex
CREATE INDEX "CardTemplateChecklist_templateId_idx" ON "CardTemplateChecklist"("templateId");

-- CreateIndex
CREATE INDEX "CardTemplateItem_checklistId_idx" ON "CardTemplateItem"("checklistId");

-- AddForeignKey
ALTER TABLE "BoardTemplate" ADD CONSTRAINT "BoardTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardTemplate" ADD CONSTRAINT "BoardTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardTemplateList" ADD CONSTRAINT "BoardTemplateList_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "BoardTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardTemplateCard" ADD CONSTRAINT "BoardTemplateCard_listId_fkey" FOREIGN KEY ("listId") REFERENCES "BoardTemplateList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTemplate" ADD CONSTRAINT "CardTemplate_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTemplateChecklist" ADD CONSTRAINT "CardTemplateChecklist_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CardTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTemplateItem" ADD CONSTRAINT "CardTemplateItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "CardTemplateChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
