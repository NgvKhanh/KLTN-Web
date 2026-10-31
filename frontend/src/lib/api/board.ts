import { api } from '../axios';
import type {
  Board,
  BoardMember,
  BoardRole,
  BoardVisibility,
  InviteLink,
  InvitePreview,
  JoinRequest,
} from '../../types/board';
import type { CardStatus } from '../../types/card';

export async function fetchMyBoards(): Promise<Board[]> {
  const res = await api.get<{ data: { boards: Board[] } }>('/boards');
  return res.data.data.boards;
}

// Lay 1 bang theo id (dung khi mo bang cong khai chua phai thanh vien)
export async function fetchBoard(boardId: string): Promise<Board> {
  const res = await api.get<{ data: { board: Board } }>(`/boards/${boardId}`);
  return res.data.data.board;
}

export interface ArchivedCard {
  id: string;
  title: string;
  archivedAt: string;
  list: { id: string; name: string };
}
export interface ArchivedList {
  id: string;
  name: string;
  archivedAt: string;
  cardCount: number;
}

// Cac muc da luu tru cua bang
export async function fetchBoardArchive(
  boardId: string
): Promise<{ cards: ArchivedCard[]; lists: ArchivedList[] }> {
  const res = await api.get<{
    data: { cards: ArchivedCard[]; lists: ArchivedList[] };
  }>(`/boards/${boardId}/archive`);
  return res.data.data;
}

export interface BoardActivity {
  id: string;
  type: string;
  data: Record<string, string>;
  createdAt: string;
  user: { id: string; name: string; avatarUrl: string | null };
  card: { id: string; title: string } | null;
}

// Nhat ky hoat dong ca bang
export async function fetchBoardActivity(
  boardId: string
): Promise<BoardActivity[]> {
  const res = await api.get<{ data: { activities: BoardActivity[] } }>(
    `/activities/board/${boardId}`
  );
  return res.data.data.activities;
}

export interface HomeActivity extends Omit<BoardActivity, 'card'> {
  board: { id: string; name: string } | null;
  // title = null khi the da chuyen sang bang khac sau khi ghi nhat ky (server che ten)
  card: { id: string; title: string | null } | null;
}

export type HomeActivityScope = 'all' | 'others';

// Nhat ky gop tren moi bang cua toi; 'others' = chi viec nguoi khac lam
export async function fetchHomeActivity(scope: HomeActivityScope = 'all'): Promise<HomeActivity[]> {
  const res = await api.get<{ data: { activities: HomeActivity[] } }>(
    '/activities/home',
    scope === 'others' ? { params: { scope } } : undefined
  );
  return res.data.data.activities;
}

export async function createBoard(input: {
  name: string;
  workspaceId: string;
  color?: string;
  backgroundImage?: string;
}): Promise<Board> {
  const res = await api.post<{ data: { board: Board } }>('/boards', input);
  return res.data.data.board;
}

export async function updateBoard(
  boardId: string,
  input: {
    name?: string;
    color?: string;
    backgroundImage?: string | null;
    visibility?: BoardVisibility;
  }
): Promise<Board> {
  const res = await api.patch<{ data: { board: Board } }>(
    `/boards/${boardId}`,
    input
  );
  return res.data.data.board;
}

export async function deleteBoard(boardId: string): Promise<void> {
  await api.delete(`/boards/${boardId}`);
}

// ----- Luu tru / khoi phuc / xoa han ca bang -----
export interface ArchivedBoard {
  id: string;
  name: string;
  color: string;
  backgroundImage: string | null;
  isOwner: boolean;
  archivedAt: string;
}
export async function fetchArchivedBoards(): Promise<ArchivedBoard[]> {
  const res = await api.get<{ data: { boards: ArchivedBoard[] } }>(
    '/boards/archived'
  );
  return res.data.data.boards;
}
export async function archiveBoard(boardId: string): Promise<void> {
  await api.post(`/boards/${boardId}/archive-board`);
}
export async function restoreBoard(boardId: string): Promise<void> {
  await api.post(`/boards/${boardId}/restore`);
}
export async function purgeBoard(boardId: string): Promise<void> {
  await api.delete(`/boards/${boardId}/purge`);
}

// Xuat bang ra JSON (tra ve doi tuong long nhau)
export async function exportBoard(boardId: string): Promise<unknown> {
  const res = await api.get<{ data: unknown }>(`/boards/${boardId}/export`);
  return res.data.data;
}

// ----- Mau bang -----
export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  /** Nhom (id trong TemplateCategory). */
  category: string;
  color: string;
  /** Nhan tao san cua mau; khong co = bang dung bo nhan mac dinh. */
  labels?: { name: string; color: string }[];
  /** `status`: trang thai cua cot (null = cot tu do). */
  lists: { name: string; status: CardStatus | null; cards: string[] }[];
}
export interface TemplateCategory {
  id: string;
  name: string;
}
export async function fetchTemplates(): Promise<{
  templates: BoardTemplate[];
  categories: TemplateCategory[];
}> {
  const res = await api.get<{
    data: { templates: BoardTemplate[]; categories: TemplateCategory[] };
  }>('/boards/templates');
  return { templates: res.data.data.templates, categories: res.data.data.categories ?? [] };
}
export async function createBoardFromTemplate(
  templateId: string,
  workspaceId: string,
  name?: string
): Promise<Board> {
  const res = await api.post<{ data: { board: Board } }>('/boards/from-template', {
    templateId,
    workspaceId,
    ...(name ? { name } : {}),
  });
  return res.data.data.board;
}

// Danh dau / bo danh dau sao bang
export async function setBoardStar(
  boardId: string,
  starred: boolean
): Promise<void> {
  await api.put(`/boards/${boardId}/star`, { starred });
}

// Theo doi / bo theo doi bang: nhan thong bao hoat dong du khong phai thanh vien duoc gan
export async function setBoardWatch(
  boardId: string,
  watching: boolean
): Promise<void> {
  await api.put(`/boards/${boardId}/watch`, { watching });
}

// Tai anh nen len (field "image", dang multipart/form-data)
export async function uploadBoardBackground(
  boardId: string,
  file: File
): Promise<Board> {
  const form = new FormData();
  form.append('image', file);
  const res = await api.post<{ data: { board: Board } }>(
    `/boards/${boardId}/background`,
    form
  );
  return res.data.data.board;
}

// Bo anh nen, quay ve dung mau
export async function clearBoardBackground(boardId: string): Promise<Board> {
  const res = await api.delete<{ data: { board: Board } }>(
    `/boards/${boardId}/background`
  );
  return res.data.data.board;
}

// ----- Thanh vien bang -----
export async function fetchBoardMembers(
  boardId: string
): Promise<BoardMember[]> {
  const res = await api.get<{ data: { members: BoardMember[] } }>(
    `/boards/${boardId}/members`
  );
  return res.data.data.members;
}

// Ket qua: da them thanh vien ngay (user co tai khoan) hoac da gui email moi.
export type AddMemberResult =
  | { kind: 'member'; member: BoardMember }
  | { kind: 'invited'; email: string };

export async function addBoardMember(
  boardId: string,
  email: string,
  role: Exclude<BoardRole, 'OWNER'> = 'MEMBER'
): Promise<AddMemberResult> {
  const res = await api.post<{
    data: { member?: BoardMember; invitedEmail?: string };
  }>(`/boards/${boardId}/members`, { email, role });
  const { member, invitedEmail } = res.data.data;
  if (member) return { kind: 'member', member };
  return { kind: 'invited', email: invitedEmail ?? email };
}

// Chuyen quyen so huu bang cho 1 thanh vien khac (chi chu bang goi duoc)
export async function transferOwnership(
  boardId: string,
  userId: string
): Promise<void> {
  await api.post(`/boards/${boardId}/members/${userId}/transfer-ownership`);
}

export async function changeMemberRole(
  boardId: string,
  userId: string,
  role: Exclude<BoardRole, 'OWNER'>
): Promise<BoardMember> {
  const res = await api.patch<{ data: { member: BoardMember } }>(
    `/boards/${boardId}/members/${userId}`,
    { role }
  );
  return res.data.data.member;
}

export async function removeBoardMember(
  boardId: string,
  userId: string
): Promise<void> {
  await api.delete(`/boards/${boardId}/members/${userId}`);
}

// ----- Link moi -----
export async function getInviteLink(boardId: string): Promise<InviteLink> {
  const res = await api.get<{ data: InviteLink }>(
    `/boards/${boardId}/invite-link`
  );
  return res.data.data;
}

export async function createInviteLink(boardId: string): Promise<InviteLink> {
  const res = await api.post<{ data: InviteLink }>(
    `/boards/${boardId}/invite-link`
  );
  return res.data.data;
}

export async function disableInviteLink(boardId: string): Promise<void> {
  await api.delete(`/boards/${boardId}/invite-link`);
}

// ----- Yeu cau tham gia -----
export async function fetchJoinRequests(
  boardId: string
): Promise<JoinRequest[]> {
  const res = await api.get<{ data: { requests: JoinRequest[] } }>(
    `/boards/${boardId}/join-requests`
  );
  return res.data.data.requests;
}

export async function approveJoinRequest(
  boardId: string,
  requestId: string
): Promise<BoardMember> {
  const res = await api.post<{ data: { member: BoardMember } }>(
    `/boards/${boardId}/join-requests/${requestId}/approve`
  );
  return res.data.data.member;
}

export async function rejectJoinRequest(
  boardId: string,
  requestId: string
): Promise<void> {
  await api.post(`/boards/${boardId}/join-requests/${requestId}/reject`);
}

// ----- Vao bang bang link -----
export async function previewInvite(token: string): Promise<InvitePreview> {
  const res = await api.get<{ data: InvitePreview }>(`/boards/join/${token}`);
  return res.data.data;
}

export async function requestToJoin(
  token: string
): Promise<{ boardName: string }> {
  const res = await api.post<{ data: { boardName: string } }>(
    `/boards/join/${token}`
  );
  return res.data.data;
}
