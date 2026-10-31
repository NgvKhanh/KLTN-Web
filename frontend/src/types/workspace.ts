export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface Workspace {
  id: string;
  ownerId: string;
  name: string;
  isPersonal: boolean;
  createdAt: string;
  updatedAt: string;
  // Chi co trong danh sach / chi tiet
  myRole?: WorkspaceRole;
  memberCount?: number;
  boardCount?: number;
}

interface WorkspaceUserBrief {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  user: WorkspaceUserBrief;
}
