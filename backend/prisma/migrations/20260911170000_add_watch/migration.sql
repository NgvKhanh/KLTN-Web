-- CreateTable
CREATE TABLE "Watch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "boardId" TEXT,
    "listId" TEXT,
    "cardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Watch_boardId_idx" ON "Watch"("boardId");

-- CreateIndex
CREATE INDEX "Watch_listId_idx" ON "Watch"("listId");

-- CreateIndex
CREATE INDEX "Watch_cardId_idx" ON "Watch"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "Watch_userId_boardId_key" ON "Watch"("userId", "boardId");

-- CreateIndex
CREATE UNIQUE INDEX "Watch_userId_listId_key" ON "Watch"("userId", "listId");

-- CreateIndex
CREATE UNIQUE INDEX "Watch_userId_cardId_key" ON "Watch"("userId", "cardId");

-- AddForeignKey
ALTER TABLE "Watch" ADD CONSTRAINT "Watch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watch" ADD CONSTRAINT "Watch_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watch" ADD CONSTRAINT "Watch_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watch" ADD CONSTRAINT "Watch_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
