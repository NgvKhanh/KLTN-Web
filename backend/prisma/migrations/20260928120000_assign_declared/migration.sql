-- Buoc 16 module goi y phan cong (ASSIGN_MODULE.md §17.8): trong so thanh phan "Ho so" + bang ho so tu khai.
-- wDeclared NULL = dong truoc buoc 16: dich vu NANG CAP khi doc (upgradeLegacyWeights). KHONG quy doi trong so cu bang SQL:
-- nhan 0,8 vao mot trong so 0,05 cho 0,04 < muc san -> dong bi coi la hong -> dich vu lang le lui ve mac dinh.
-- AlterTable
ALTER TABLE "WorkspaceAssignWeights" ADD COLUMN     "wDeclared" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "AssignWeightHistory" ADD COLUMN     "wDeclared" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "UserAssignProfile" (
    "userId" TEXT NOT NULL,
    "useForAssign" BOOLEAN NOT NULL DEFAULT true,
    "skillsText" TEXT NOT NULL DEFAULT '',
    "workItems" JSONB NOT NULL DEFAULT '[]',
    "cvText" TEXT,
    "cvFileName" TEXT,
    "cvStoredName" TEXT,
    "cvSize" INTEGER,
    "cvUploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAssignProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAssignProfile_cvStoredName_key" ON "UserAssignProfile"("cvStoredName");

-- AddForeignKey
ALTER TABLE "UserAssignProfile" ADD CONSTRAINT "UserAssignProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

