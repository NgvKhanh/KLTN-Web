ALTER TABLE "ChecklistItem" ADD COLUMN "assigneeId" TEXT;
ALTER TABLE "ChecklistItem" ADD COLUMN "dueDate" TIMESTAMP(3);

CREATE INDEX "ChecklistItem_assigneeId_idx" ON "ChecklistItem"("assigneeId");

ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
