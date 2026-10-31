-- Cho phep passwordHash rong: tai khoan chi dang nhap bang Google khong co mat khau
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- Luu "sub" cua Google de nhan dien tai khoan o cac lan dang nhap sau
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
