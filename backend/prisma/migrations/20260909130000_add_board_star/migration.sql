-- CreateTable
CREATE TABLE "BoardStar" (
    "userId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardStar_pkey" PRIMARY KEY ("userId","boardId")
);

-- CreateIndex
CREATE INDEX "BoardStar_boardId_idx" ON "BoardStar"("boardId");

-- AddForeignKey
ALTER TABLE "BoardStar" ADD CONSTRAINT "BoardStar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardStar" ADD CONSTRAINT "BoardStar_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Di chuyen du lieu dau sao hien co tu BoardMember
INSERT INTO "BoardStar" ("userId","boardId")
SELECT "userId","boardId" FROM "BoardMember"
WHERE "starred" = true AND "deletedAt" IS NULL
ON CONFLICT DO NOTHING;
