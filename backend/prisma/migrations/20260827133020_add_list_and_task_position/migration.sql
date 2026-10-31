-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "listId" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "List" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "List_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "List_projectId_idx" ON "List"("projectId");

-- CreateIndex
CREATE INDEX "Task_listId_idx" ON "Task"("listId");

-- AddForeignKey
ALTER TABLE "List" ADD CONSTRAINT "List_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- BACKFILL: chuyen du lieu cu sang mo hinh List
-- ============================================================

-- 1) Moi du an dang ton tai duoc tao 5 list mac dinh, tuong ung 5 trang thai cu.
INSERT INTO "List" ("id", "projectId", "name", "position", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."id", v.name, v.pos, now(), now()
FROM "Project" p
CROSS JOIN (VALUES
  ('Cần làm', 0),
  ('Đang làm', 1),
  ('Chờ duyệt', 2),
  ('Hoàn thành', 3),
  ('Bị chặn', 4)
) AS v(name, pos)
WHERE p."deletedAt" IS NULL;

-- 2) Gan moi task vao list cua du an minh theo trang thai hien tai.
UPDATE "Task" t
SET "listId" = l."id"
FROM "List" l
WHERE l."projectId" = t."projectId"
  AND l."name" = CASE t."status"
    WHEN 'TODO' THEN 'Cần làm'
    WHEN 'IN_PROGRESS' THEN 'Đang làm'
    WHEN 'REVIEW' THEN 'Chờ duyệt'
    WHEN 'DONE' THEN 'Hoàn thành'
    WHEN 'BLOCKED' THEN 'Bị chặn'
  END;

-- 3) Danh so thu tu (position) cho task trong tung list theo thoi diem tao.
WITH ordered AS (
  SELECT "id",
         row_number() OVER (PARTITION BY "listId" ORDER BY "createdAt", "id") - 1 AS rn
  FROM "Task"
  WHERE "listId" IS NOT NULL
)
UPDATE "Task" t
SET "position" = ordered.rn
FROM ordered
WHERE ordered."id" = t."id";
