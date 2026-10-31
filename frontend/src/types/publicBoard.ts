// Du lieu tra ve tu /api/public/* - xem bang PUBLIC khong can dang nhap.
// Rieng tu (email) KHONG bao gio co trong cac kieu nay - chi id/ten/anh dai dien.

export interface PublicUserBrief {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface PublicBoard {
  id: string;
  name: string;
  color: string;
  backgroundImage: string | null;
  workspaceName: string;
}

export interface PublicLabel {
  id: string;
  boardId: string;
  name: string;
  color: string;
}

export interface PublicCardSummary {
  id: string;
  title: string;
  isDone: boolean;
  startDate: string | null;
  dueDate: string | null;
  coverColor: string | null;
  coverImageUrl: string | null;
  position: number;
  labels: { labelId: string; label: PublicLabel }[];
  members: { userId: string; user: PublicUserBrief }[];
  _count: { comments: number; attachments: number; checklists: number };
}

export interface PublicList {
  id: string;
  name: string;
  position: number;
  cards: PublicCardSummary[];
}

export interface PublicChecklistItem {
  id: string;
  content: string;
  isDone: boolean;
  position: number;
  dueDate: string | null;
  assignee: PublicUserBrief | null;
}

export interface PublicChecklist {
  id: string;
  title: string;
  position: number;
  items: PublicChecklistItem[];
}

export interface PublicComment {
  id: string;
  parentId: string | null;
  text: string;
  createdAt: string;
  deleted?: boolean;
  user: PublicUserBrief;
}

export interface PublicAttachment {
  id: string;
  name: string;
  url: string;
  mime: string;
  size: number;
  createdAt: string;
  uploader: PublicUserBrief;
}

export interface PublicCardDetail {
  id: string;
  title: string;
  description: string | null;
  isDone: boolean;
  startDate: string | null;
  dueDate: string | null;
  coverColor: string | null;
  coverImageUrl: string | null;
  createdAt: string;
  list: { id: string; name: string; boardId: string };
  members: { userId: string; user: PublicUserBrief }[];
  labels: { labelId: string; label: PublicLabel }[];
  checklists: PublicChecklist[];
  comments: PublicComment[];
  attachments: PublicAttachment[];
}
