-- Thay co che thu hoi phien: tu moc thoi gian (passwordChangedAt) sang bo dem
-- phien tang dan (tokenVersion). Tranh sai so do phan giai giay cua JWT.iat,
-- va ap dung duoc cho ca Socket.IO (khong chi REST).

-- DropColumn
ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordChangedAt";

-- AddColumn
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
