-- BoardRole: them vai tro ADMIN (Quan tri vien)
ALTER TYPE "BoardRole" ADD VALUE IF NOT EXISTS 'ADMIN';

-- Board: token cho link moi
ALTER TABLE "Board" ADD COLUMN "inviteToken" TEXT;
CREATE UNIQUE INDEX "Board_inviteToken_key" ON "Board"("inviteToken");

-- Yeu cau tham gia bang
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "BoardJoinRequest" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardJoinRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BoardJoinRequest_boardId_idx" ON "BoardJoinRequest"("boardId");
CREATE UNIQUE INDEX "BoardJoinRequest_boardId_userId_key" ON "BoardJoinRequest"("boardId", "userId");

ALTER TABLE "BoardJoinRequest" ADD CONSTRAINT "BoardJoinRequest_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardJoinRequest" ADD CONSTRAINT "BoardJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
