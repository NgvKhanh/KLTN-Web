-- Luu tru (co the khoi phuc) cho the va danh sach
ALTER TABLE "Card" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "List" ADD COLUMN "archivedAt" TIMESTAMP(3);
