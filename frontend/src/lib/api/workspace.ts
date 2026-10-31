import { api } from '../axios';
import type { SearchCard } from './card';
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '../../types/workspace';

export async function fetchMyWorkspaces(): Promise<Workspace[]> {
  const res = await api.get<{ data: { workspaces: Workspace[] } }>('/workspaces');
  return res.data.data.workspaces;
}

export async function fetchWorkspace(workspaceId: string): Promise<Workspace> {
  const res = await api.get<{ data: { workspace: Workspace } }>(
    `/workspaces/${workspaceId}`
  );
  return res.data.data.workspace;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const res = await api.post<{ data: { workspace: Workspace } }>('/workspaces', {
    name,
  });
  return res.data.data.workspace;
}

export async function updateWorkspace(
  workspaceId: string,
  name: string
): Promise<Workspace> {
  const res = await api.patch<{ data: { workspace: Workspace } }>(
    `/workspaces/${workspaceId}`,
    { name }
  );
  return res.data.data.workspace;
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await api.delete(`/workspaces/${workspaceId}`);
}

// ----- Thanh vien khong gian -----
export async function fetchWorkspaceMembers(
  workspaceId: string
): Promise<WorkspaceMember[]> {
  const res = await api.get<{ data: { members: WorkspaceMember[] } }>(
    `/workspaces/${workspaceId}/members`
  );
  return res.data.data.members;
}

export type AddWorkspaceMemberResult =
  | { kind: 'member'; member: WorkspaceMember }
  | { kind: 'invited'; email: string };

export async function addWorkspaceMember(
  workspaceId: string,
  email: string,
  role: Exclude<WorkspaceRole, 'OWNER'> = 'MEMBER'
): Promise<AddWorkspaceMemberResult> {
  const res = await api.post<{
    data: { member?: WorkspaceMember; invitedEmail?: string };
  }>(`/workspaces/${workspaceId}/members`, { email, role });
  const { member, invitedEmail } = res.data.data;
  if (member) return { kind: 'member', member };
  return { kind: 'invited', email: invitedEmail ?? email };
}

export async function changeWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  role: Exclude<WorkspaceRole, 'OWNER'>
): Promise<WorkspaceMember> {
  const res = await api.patch<{ data: { member: WorkspaceMember } }>(
    `/workspaces/${workspaceId}/members/${userId}`,
    { role }
  );
  return res.data.data.member;
}

export async function removeWorkspaceMember(
  workspaceId: string,
  userId: string
): Promise<void> {
  await api.delete(`/workspaces/${workspaceId}/members/${userId}`);
}

// ----- Tong quan khong gian -----
export type OverviewStatusFilter = 'all' | 'overdue' | 'unassigned' | 'done';

export interface WorkspaceOverviewBoard {
  id: string;
  name: string;
  color: string;
}

export interface WorkspaceOverviewStats {
  total: number;
  done: number;
  overdue: number;
  unassigned: number;
}

export interface WorkspaceOverview {
  boards: WorkspaceOverviewBoard[];
  stats: WorkspaceOverviewStats;
  cards: SearchCard[];
}

export async function fetchWorkspaceOverview(
  workspaceId: string,
  filters: { assigneeId?: string; status?: OverviewStatusFilter } = {}
): Promise<WorkspaceOverview> {
  const params = new URLSearchParams();
  if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
  if (filters.status) params.set('status', filters.status);
  const qs = params.toString();
  const res = await api.get<{ data: WorkspaceOverview }>(
    `/workspaces/${workspaceId}/overview${qs ? `?${qs}` : ''}`
  );
  return res.data.data;
}

export async function transferWorkspaceOwnership(
  workspaceId: string,
  userId: string
): Promise<void> {
  await api.post(
    `/workspaces/${workspaceId}/members/${userId}/transfer-ownership`
  );
}
