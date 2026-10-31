// Gom danh sach binh luan phang (API tra ve) thanh cac luong 1 cap.
// - Luong xep theo binh luan goc, moi nhat truoc (giong danh sach binh luan truoc day).
// - Cau tra loi trong luong xep cu -> moi, doc nhu mot cuoc tro chuyen.
// - Goc da xoa ma khong con cau tra loi thi bo; cau tra loi mat goc (du lieu le) thanh luong rieng
//   de khong bao gio nuot mat noi dung.
export interface ThreadComment {
  id: string;
  parentId: string | null;
  createdAt: string;
  deleted?: boolean;
}

export interface CommentThreadGroup<T> {
  root: T;
  replies: T[];
}

const time = (c: ThreadComment) => new Date(c.createdAt).getTime();

export function groupCommentThreads<T extends ThreadComment>(comments: T[]): CommentThreadGroup<T>[] {
  const rootIds = new Set(comments.filter((c) => !c.parentId).map((c) => c.id));
  const repliesOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const c of comments) {
    if (c.parentId && rootIds.has(c.parentId)) {
      repliesOf.set(c.parentId, [...(repliesOf.get(c.parentId) ?? []), c]);
    } else {
      roots.push(c);
    }
  }
  return roots
    .sort((a, b) => time(b) - time(a))
    .map((root) => ({
      root,
      replies: (repliesOf.get(root.id) ?? []).sort((a, b) => time(a) - time(b)),
    }))
    .filter((t) => !t.root.deleted || t.replies.length > 0);
}
