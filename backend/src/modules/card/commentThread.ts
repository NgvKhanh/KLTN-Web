import type { Prisma } from '../../generated/prisma/client';

// Binh luan hien tren the: con hieu luc, HOAC la binh luan goc da xoa nhung van con
// cau tra loi chua xoa (hien "Binh luan da bi xoa" de luong khong mat ngu canh).
export const VISIBLE_COMMENT_WHERE = {
  OR: [
    { deletedAt: null },
    { parentId: null, replies: { some: { deletedAt: null } } },
  ],
} satisfies Prisma.CommentWhereInput;

// Binh luan goc da xoa: KHONG gui noi dung cu ve trinh duyet, chi danh dau deleted.
export function maskDeletedComments<T extends { text: string; deletedAt: Date | null }>(
  rows: T[]
) {
  return rows.map(({ deletedAt, ...c }) => ({
    ...c,
    text: deletedAt ? '' : c.text,
    deleted: deletedAt !== null,
  }));
}
