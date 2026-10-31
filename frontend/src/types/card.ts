import type { CardFieldValue } from './customField';

// Trang thai cong viec (khop enum CardStatus o backend). DONE <-> isDone = true.
export type CardStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'BLOCKED';

// The nam trong 1 danh sach
export interface Card {
  id: string;
  listId: string;
  title: string;
  description: string | null;
  status: CardStatus;
  isDone: boolean;
  startDate?: string | null;
  dueDate?: string | null;
  coverColor?: string | null;
  coverImageUrl?: string | null;
  // Do phuc tap (story point) 1 / 2 / 3 / 5 / 8; null = chua nhap
  storyPoints?: number | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  // Chi co khi tai kem (danh sach the trong bang) - dung ve huy hieu
  labels?: { labelId: string; label: Label }[];
  members?: { userId: string; user: CardUserBrief }[];
  checklists?: { id: string; items: { id: string; isDone: boolean }[] }[];
  comments?: { id: string }[];
  attachments?: { id: string }[];
}

export interface CardAttachment {
  id: string;
  name: string;
  url: string;
  mime: string;
  size: number;
  createdAt: string;
  uploader: { id: string; name: string; avatarUrl: string | null };
}

interface CardUserBrief {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface Label {
  id: string;
  boardId: string;
  name: string;
  color: string;
}

export interface ChecklistItem {
  id: string;
  checklistId: string;
  content: string;
  isDone: boolean;
  position: number;
  assigneeId?: string | null;
  assignee?: { id: string; name: string; avatarUrl: string | null } | null;
  dueDate?: string | null;
}

export interface Checklist {
  id: string;
  cardId: string;
  title: string;
  position: number;
  items: ChecklistItem[];
}

export interface CardComment {
  id: string;
  // null = binh luan goc; co gia tri = cau tra loi trong luong cua binh luan goc do
  parentId: string | null;
  text: string;
  createdAt: string;
  // Binh luan goc da xoa nhung con cau tra loi: text rong, chi hien "Binh luan da bi xoa"
  deleted?: boolean;
  user: CardUserBrief;
}

export interface CardActivity {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
  user: { id: string; name: string; avatarUrl: string | null };
}

// Tra ve tu GET /api/cards/:id
export interface CardDetail {
  id: string;
  listId: string;
  title: string;
  description: string | null;
  status: CardStatus;
  isDone: boolean;
  startDate: string | null;
  dueDate: string | null;
  coverColor: string | null;
  coverImageUrl: string | null;
  storyPoints: number | null;
  createdAt: string;
  list: { id: string; name: string; boardId: string; status: CardStatus | null };
  members: { userId: string; user: CardUserBrief }[];
  labels: { labelId: string; label: Label }[];
  checklists: Checklist[];
  comments: CardComment[];
  attachments: CardAttachment[];
  activities: CardActivity[];
  isWatching: boolean;
  fieldValues: CardFieldValue[];
}
