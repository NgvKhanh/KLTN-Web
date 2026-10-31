-- Cho phep moi thanh vien tu ghim (danh sao) bang trong danh sach cua minh
ALTER TABLE "ProjectMember" ADD COLUMN "isStarred" BOOLEAN NOT NULL DEFAULT false;
