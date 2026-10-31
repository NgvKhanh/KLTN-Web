-- Khong gian lam viec (Workspace): moi bang bat buoc thuoc dung 1 khong gian.
-- Moi nguoi dung co san 1 khong gian ca nhan; bang cu duoc don vao khong gian
-- ca nhan cua chu bang.

-- ===== Enum vai tro trong khong gian =====
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- ===== Bang Workspace =====
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPersonal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Workspace_ownerId_idx" ON "Workspace"("ownerId");
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Bang WorkspaceMember =====
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Cot moi (tam thoi cho phep NULL de con backfill) =====
ALTER TABLE "Board" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "workspaceId" TEXT;

-- ===== Backfill: 1 khong gian ca nhan cho moi nguoi dung =====
INSERT INTO "Workspace" ("id", "ownerId", "name", "isPersonal", "createdAt", "updatedAt")
SELECT 'ws_' || replace(gen_random_uuid()::text, '-', ''),
       u."id",
       'Không gian của ' || u."name",
       true,
       now(),
       now()
FROM "User" u;

-- Chu khong gian la thanh vien OWNER
INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt", "updatedAt")
SELECT 'wm_' || replace(gen_random_uuid()::text, '-', ''),
       w."id",
       w."ownerId",
       'OWNER',
       now(),
       now()
FROM "Workspace" w;

-- Gan moi bang vao khong gian ca nhan cua chu bang
UPDATE "Board" b
SET "workspaceId" = w."id"
FROM "Workspace" w
WHERE w."ownerId" = b."ownerId" AND w."isPersonal" = true;

-- ===== Chot rang buoc: bang phai co khong gian =====
ALTER TABLE "Board" ALTER COLUMN "workspaceId" SET NOT NULL;
CREATE INDEX "Board_workspaceId_idx" ON "Board"("workspaceId");
ALTER TABLE "Board" ADD CONSTRAINT "Board_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
