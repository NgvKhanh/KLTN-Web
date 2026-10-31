-- Chuyen ve ban skeleton: chi con xac thuc nguoi dung.
-- Xoa toan bo bang chuc nang (Team / Project / List / Task / ...) va cac enum lien quan.
-- Du lieu trong cac bang nay se mat; bang "User" va cac tai khoan duoc giu nguyen.

DROP TABLE IF EXISTS "Notification" CASCADE;
DROP TABLE IF EXISTS "ActivityLog" CASCADE;
DROP TABLE IF EXISTS "Attachment" CASCADE;
DROP TABLE IF EXISTS "CommentMention" CASCADE;
DROP TABLE IF EXISTS "Comment" CASCADE;
DROP TABLE IF EXISTS "TaskDependency" CASCADE;
DROP TABLE IF EXISTS "Subtask" CASCADE;
DROP TABLE IF EXISTS "Task" CASCADE;
-- KHONG xoa "List" o day: tu 20260828154735 bang List da chuyen sang mo hinh
-- theo Board va con duoc dung o cac migration sau (vd 20260907120300_archive).
-- FK cua "Task" -> "List" da bi xoa theo `DROP TABLE "Task" CASCADE` ben tren.
DROP TABLE IF EXISTS "ProjectMember" CASCADE;
DROP TABLE IF EXISTS "Project" CASCADE;
DROP TABLE IF EXISTS "TeamMember" CASCADE;
DROP TABLE IF EXISTS "Team" CASCADE;

DROP TYPE IF EXISTS "NotificationType";
DROP TYPE IF EXISTS "AttachmentType";
DROP TYPE IF EXISTS "TaskPriority";
DROP TYPE IF EXISTS "TaskStatus";
DROP TYPE IF EXISTS "ProjectRole";
DROP TYPE IF EXISTS "TeamRole";

-- Bo dang nhap bang Google: xoa cot googleId, tra passwordHash ve bat buoc
DROP INDEX IF EXISTS "User_googleId_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "googleId";
ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;
