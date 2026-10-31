export type BoardVisibility = 'PRIVATE' | 'WORKSPACE' | 'PUBLIC';

export interface Board {
  id: string;
  ownerId: string;
  workspaceId: string;
  name: string;
  color: string;
  backgroundImage: string | null;
  visibility: BoardVisibility;
  createdAt: string;
  updatedAt: string;
  // Ten khong gian chua bang (GET /api/boards va GET /api/boards/:id)
  workspaceName?: string;
  workspaceIsPersonal?: boolean;
  // Chi co trong danh sach bang (GET /api/boards)
  memberCount?: number;
  // Chi co trong danh sach bang: tong so the va so the da hoan thanh (thanh tien do)
  cardCount?: number;
  doneCount?: number;
  isOwner?: boolean;
  isMember?: boolean;
  isStarred?: boolean;
  // Chi co khi GET /api/boards/:id (nguoi xem co the chua la thanh vien)
  canEdit?: boolean;
  // Chi co khi GET /api/boards/:id: quyen quan ly bang (tinh ca OWNER/ADMIN
  // cua khong gian chua bang), do backend tinh san.
  canManage?: boolean;
  // Chi co khi GET /api/boards/:id: minh co dang theo doi (watch) bang nay khong.
  isWatching?: boolean;
}

export type BoardRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

interface BoardUserBrief {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface BoardMember {
  id: string;
  boardId: string;
  userId: string;
  role: BoardRole;
  user: BoardUserBrief;
  // true = có quyền qua "Không gian làm việc", chưa được thêm thẳng vào bảng
  viaWorkspace?: boolean;
}

export interface JoinRequest {
  id: string;
  boardId: string;
  userId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  user: BoardUserBrief;
}

export interface InviteLink {
  token: string | null;
  url: string | null;
}

// Xem truoc khi vao bang bang link moi
export interface InvitePreview {
  board: {
    id: string;
    name: string;
    color: string;
    backgroundImage: string | null;
  };
  status: 'member' | 'pending' | 'none';
}
