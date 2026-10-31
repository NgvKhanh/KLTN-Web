import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace, WorkspaceMember } from '../types/workspace';

// Trang cai dat khong gian - CHI phan nut "Xem CV" o danh sach thanh vien (may chu quyet dinh ai xem duoc). Cac lop goi API, ngu
// canh va socket deu duoc mock; bang trong so goi y phan cong co test rieng nen thay bang thanh phan rong.

const fetchCvAccess = vi.fn();
vi.mock('../lib/api/assign', () => ({
  fetchCvAccess: (...a: unknown[]) => fetchCvAccess(...a),
  userCvUrl: (id: string) => `http://api.test/users/${id}/assign-profile/cv`,
}));

const WS: Workspace = { id: 'w1', ownerId: 'u-owner', name: 'Nhom do an', isPersonal: false, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', myRole: 'OWNER' };
const member = (userId: string, name: string, role: WorkspaceMember['role']): WorkspaceMember => ({
  id: `m-${userId}`,
  workspaceId: 'w1',
  userId,
  role,
  user: { id: userId, name, email: `${userId}@x.vn`, avatarUrl: null },
});
const MEMBERS = [member('u-owner', 'Chu Nhom', 'OWNER'), member('u-1', 'Lan Nguyen', 'MEMBER'), member('u-2', 'Binh Tran', 'MEMBER')];

vi.mock('../lib/api/workspace', () => ({
  fetchWorkspace: vi.fn(() => Promise.resolve(WS)),
  fetchWorkspaceMembers: vi.fn(() => Promise.resolve(MEMBERS)),
  fetchWorkspaceOverview: vi.fn(() => Promise.resolve({ boards: [], stats: { total: 0, done: 0, overdue: 0, unassigned: 0 }, cards: [] })),
  addWorkspaceMember: vi.fn(),
  changeWorkspaceMemberRole: vi.fn(),
  deleteWorkspace: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  transferWorkspaceOwnership: vi.fn(),
  updateWorkspace: vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-owner', name: 'Chu Nhom' } }) }));
vi.mock('../context/BoardsContext', () => ({ useBoards: () => ({ boards: [] }) }));
vi.mock('../context/WorkspacesContext', () => ({ useWorkspaces: () => ({ reload: vi.fn(), removeWorkspace: vi.fn(), setCurrentWorkspaceId: vi.fn() }) }));
vi.mock('../lib/socket', () => ({ socket: { on: vi.fn(), off: vi.fn() } }));
vi.mock('../components/AssignWeightsPanel', () => ({ default: () => null }));

import WorkspaceSettingsPage from './WorkspaceSettingsPage';

function setup() {
  render(
    <MemoryRouter initialEntries={['/workspaces/w1?tab=members']}>
      <Routes>
        <Route path="/workspaces/:workspaceId" element={<WorkspaceSettingsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  fetchCvAccess.mockReset();
});

describe('WorkspaceSettingsPage - nut "Xem CV" o danh sach thanh vien', () => {
  it('hoi may chu cho ca danh sach thanh vien; chi nguoi duoc phep co nut, dung duong dan', async () => {
    fetchCvAccess.mockResolvedValue(['u-2']);
    setup();
    const link = await screen.findByRole('link', { name: 'Xem CV của Binh Tran' });
    expect(link).toHaveAttribute('href', 'http://api.test/users/u-2/assign-profile/cv');
    expect([...fetchCvAccess.mock.calls.at(-1)![0]].sort()).toEqual(['u-1', 'u-2', 'u-owner']);
    expect(screen.queryByRole('link', { name: 'Xem CV của Lan Nguyen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Xem CV của Chu Nhom' })).not.toBeInTheDocument();
  });

  it('may chu khong cho ai -> khong co nut nao, danh sach van hien day du', async () => {
    fetchCvAccess.mockResolvedValue([]);
    setup();
    await screen.findAllByText('Lan Nguyen');
    await waitFor(() => expect(fetchCvAccess).toHaveBeenCalled());
    expect(screen.getAllByText('Binh Tran').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /Xem CV/ })).not.toBeInTheDocument();
  });
});
