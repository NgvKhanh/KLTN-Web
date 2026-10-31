export interface AppNotification {
  id: string;
  type: string;
  boardId: string | null;
  cardId: string | null;
  workspaceId: string | null;
  data: Record<string, string>;
  isRead: boolean;
  createdAt: string;
  actor: { id: string; name: string; avatarUrl: string | null };
}
