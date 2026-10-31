export interface UserBoardTemplateCard {
  id: string;
  title: string;
  description: string | null;
  position: number;
}

export interface UserBoardTemplateList {
  id: string;
  name: string;
  position: number;
  /** Trang thai cot luc chup mau (null = cot tu do). */
  status?: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'BLOCKED' | null;
  cards: UserBoardTemplateCard[];
}

export interface UserBoardTemplate {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  createdById: string;
  createdAt: string;
  createdBy: { id: string; name: string; avatarUrl: string | null };
  lists: UserBoardTemplateList[];
}
