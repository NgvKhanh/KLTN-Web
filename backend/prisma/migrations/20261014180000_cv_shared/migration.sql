-- AlterTable
-- Cho phep nguoi quan ly chung tai TEP CV. Mac dinh FALSE: truoc day bat ky ai them nguoi nay vao bang cua minh
-- deu tai duoc CV (khong can ho dong y); gio chi sau khi chu CV tu bat o trang Ho so.
ALTER TABLE "UserAssignProfile" ADD COLUMN     "cvShared" BOOLEAN NOT NULL DEFAULT false;
