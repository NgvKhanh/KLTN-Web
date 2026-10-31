-- Trang thai theo cot: cot (List) gan 1 trang thai tuy chon, the (Card) luon co 1 trang thai.

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED');

-- AlterTable
ALTER TABLE "BoardTemplateList" ADD COLUMN     "status" "CardStatus";

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "status" "CardStatus" NOT NULL DEFAULT 'TODO';

-- AlterTable
ALTER TABLE "List" ADD COLUMN     "status" "CardStatus";

-- Backfill: the da danh dau xong -> DONE, con lai giu TODO (mac dinh).
-- Cot cu de null (cot tu do); KHONG dong toi isDone/completedAt cua the cu.
UPDATE "Card" SET "status" = 'DONE' WHERE "isDone" = true;
