import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '../types/board';
import type { Workspace, WorkspaceMember } from '../types/workspace';
import type { WorkspaceOverview } from '../lib/api/workspace';
import WorkspaceSettingsPage from './WorkspaceSettingsPage';

const mocks = vi.hoisted(() => ({
  boards: [] as Board[],
  fetchWorkspace: vi.fn(), fetchWorkspaceMembers: vi.fn(), fetchWorkspaceOverview: vi.fn(),
  addWorkspaceMember: vi.fn(), changeWorkspaceMemberRole: vi.fn(), removeWorkspaceMember: vi.fn(),
  transferWorkspaceOwnership: vi.fn(), deleteWorkspace: vi.fn(), updateWorkspace: vi.fn(),
  reloadWorkspaces: vi.fn(), removeWorkspace: vi.fn(), setCurrentWorkspaceId: vi.fn(),
  reloadBoards: vi.fn(), upsertBoard: vi.fn(), createBoard: vi.fn(), onFirstLoad: vi.fn(),
}));

vi.mock('../lib/api/workspace', () => ({
  fetchWorkspace: mocks.fetchWorkspace, fetchWorkspaceMembers: mocks.fetchWorkspaceMembers,
  fetchWorkspaceOverview: mocks.fetchWorkspaceOverview, addWorkspaceMember: mocks.addWorkspaceMember,
  changeWorkspaceMemberRole: mocks.changeWorkspaceMemberRole, removeWorkspaceMember: mocks.removeWorkspaceMember,
  transferWorkspaceOwnership: mocks.transferWorkspaceOwnership, deleteWorkspace: mocks.deleteWorkspace,
  updateWorkspace: mocks.updateWorkspace,
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner', name: 'Khánh' } }) }));
vi.mock('../context/BoardsContext', () => ({ useBoards: () => ({ boards: mocks.boards, isLoading: false, error: null, reload: mocks.reloadBoards, upsertBoard: mocks.upsertBoard }) }));
vi.mock('../context/WorkspacesContext', () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: 'w1', name: 'Nhóm dự án' }, { id: 'other', name: 'Không gian khác' }],
    currentWorkspaceId: 'other', reload: mocks.reloadWorkspaces,
    removeWorkspace: mocks.removeWorkspace, setCurrentWorkspaceId: mocks.setCurrentWorkspaceId,
  }),
}));
vi.mock('../lib/socket', () => ({ socket: { on: vi.fn(), off: vi.fn() } }));
vi.mock('../lib/useCvAccess', () => ({ useCvAccess: () => new Set<string>() }));
vi.mock('../lib/api/assign', () => ({ userCvUrl: (id: string) => `/users/${id}/cv` }));
vi.mock('../components/AssignWeightsPanel', () => ({ default: ({ workspaceId }: { workspaceId: string }) => <div data-testid="assignment-settings">Cấu hình {workspaceId}</div> }));
vi.mock('../lib/api/board', () => ({ createBoard: mocks.createBoard }));
vi.mock('../lib/api/unsplash', () => ({ trackUnsplashDownload: vi.fn() }));
vi.mock('../lib/useUnsplashPhotos', () => ({
  useUnsplashPhotos: () => ({ photos: [], loading: false, loadingMore: false, error: null, unavailable: true, search: '', setSearch: vi.fn(), loadMore: vi.fn(), canLoadMore: false, onFirstLoad: mocks.onFirstLoad }),
}));

const WS: Workspace = { id: 'w1', name: 'Nhóm dự án', ownerId: 'owner', isPersonal: false, myRole: 'OWNER', boardCount: 1, memberCount: 2, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
const member = (userId: string, name: string, role: WorkspaceMember['role']): WorkspaceMember => ({ id: `m-${userId}`, workspaceId: 'w1', userId, role, user: { id: userId, name, email: `${userId}@example.test`, avatarUrl: null } });
const MEMBERS = [member('owner', 'Khánh', 'OWNER'), member('lan', 'Lan', 'MEMBER')];
const BOARD: Board = { id: 'b1', name: 'Ra mắt sản phẩm', ownerId: 'owner', workspaceId: 'w1', visibility: 'WORKSPACE', color: '#06b6d4', backgroundImage: null, cardCount: 4, doneCount: 2, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
const OVERVIEW: WorkspaceOverview = {
  boards: [{ id: 'b1', name: BOARD.name, color: BOARD.color }],
  stats: { total: 4, done: 2, overdue: 1, unassigned: 1 },
  cards: [{ id: 'c1', title: 'Thiết kế trang chủ', isDone: false, dueDate: null, coverColor: null, labels: [], members: [], list: { id: 'l1', name: 'Cần làm', boardId: 'b1', board: { id: 'b1', name: BOARD.name, color: BOARD.color } } }],
};

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}
function setup(path = '/workspaces/w1') {
  return render(<MemoryRouter initialEntries={[path]}><Location /><Routes><Route path="/workspaces/:workspaceId" element={<WorkspaceSettingsPage />} /><Route path="/boards/:boardId" element={<p>Trang bảng</p>} /><Route path="/boards" element={<p>Danh sách bảng</p>} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.boards = [BOARD, { ...BOARD, id: 'b-other', workspaceId: 'other', name: 'Bảng khác' }];
  mocks.fetchWorkspace.mockResolvedValue({ ...WS });
  mocks.fetchWorkspaceMembers.mockResolvedValue([...MEMBERS]);
  mocks.fetchWorkspaceOverview.mockResolvedValue(OVERVIEW);
  mocks.upsertBoard.mockImplementation((board: Board) => { mocks.boards = [board, ...mocks.boards]; });
  mocks.createBoard.mockResolvedValue({ ...BOARD, id: 'b-new', name: 'Bảng vừa tạo' });
  mocks.updateWorkspace.mockResolvedValue({ ...WS, name: 'Tên mới' });
  mocks.changeWorkspaceMemberRole.mockResolvedValue({ ...MEMBERS[1], role: 'ADMIN' });
  mocks.removeWorkspaceMember.mockResolvedValue(undefined);
});

describe('Workspace management', () => {
  it('opens boards by default, shows progress and navigates straight to the selected card', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { name: 'Nhóm dự án' });
    expect(screen.getByRole('tab', { name: 'Bảng & tiến độ' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Mời' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('assignment-settings')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: `Tiến độ ${BOARD.name}` })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByRole('link', { name: 'Mở bảng Bảng khác' })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.setCurrentWorkspaceId).toHaveBeenCalledWith('w1'));
    const card = await screen.findByRole('link', { name: /Thiết kế trang chủ/ });
    expect(card).toHaveAttribute('href', '/boards/b1?card=c1');
    await user.click(card);
    expect(screen.getByTestId('location')).toHaveTextContent('/boards/b1?card=c1');
  });

  it('creates in the displayed workspace despite a different global selection, and shows the new board', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Tạo bảng mới' }));
    await user.type(await screen.findByPlaceholderText('Nhập tên bảng...'), 'Bảng vừa tạo');
    await user.click(screen.getByRole('button', { name: 'Tạo mới' }));
    await waitFor(() => expect(mocks.createBoard).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1', name: 'Bảng vừa tạo' })));
    expect(await screen.findByRole('link', { name: 'Mở bảng Bảng vừa tạo' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Đã tạo bảng');
    expect(mocks.reloadWorkspaces).toHaveBeenCalled();
    expect(mocks.fetchWorkspaceOverview.mock.calls.length).toBeGreaterThan(1);
  });

  it('uses the stat buttons and assignee picker as real API filters', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: /Quá hạn/ }));
    await waitFor(() => expect(mocks.fetchWorkspaceOverview).toHaveBeenLastCalledWith('w1', { status: 'overdue', assigneeId: undefined }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Người phụ trách' }), 'lan');
    await waitFor(() => expect(mocks.fetchWorkspaceOverview).toHaveBeenLastCalledWith('w1', { status: 'overdue', assigneeId: 'lan' }));
    expect(screen.getByRole('button', { name: /Quá hạn/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores an older response after a newer filter has completed', async () => {
    const user = userEvent.setup();
    let resolveOld!: (value: WorkspaceOverview) => void;
    const old = new Promise<WorkspaceOverview>((resolve) => { resolveOld = resolve; });
    mocks.fetchWorkspaceOverview.mockImplementation((_id: string, filters: { status: string }) => filters.status === 'overdue' ? old : Promise.resolve({ ...OVERVIEW, cards: [] }));
    setup();
    await user.click(await screen.findByRole('button', { name: /Quá hạn/ }));
    await user.click(screen.getByRole('button', { name: /Đã hoàn thành/ }));
    await screen.findByText('Không có công việc nào khớp bộ lọc.');
    await act(async () => { resolveOld(OVERVIEW); });
    expect(screen.queryByRole('link', { name: /Thiết kế trang chủ/ })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Trạng thái công việc' })).toHaveValue('done');
  });

  it('explains workspace access, confirms invitations and updates roles from the server', async () => {
    const user = userEvent.setup();
    mocks.addWorkspaceMember.mockResolvedValue({ kind: 'member', member: member('minh', 'Minh', 'MEMBER') });
    setup('/workspaces/w1?tab=members');
    await screen.findByRole('heading', { name: /Thành viên \(/ });
    expect(screen.getByText('Riêng tư', { selector: 'strong' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Mời thành viên bằng email' }), 'minh@example.test');
    await user.click(screen.getByRole('button', { name: 'Mời' }));
    await waitFor(() => expect(mocks.addWorkspaceMember).toHaveBeenCalledWith('w1', 'minh@example.test', 'MEMBER'));
    expect(await screen.findByRole('status')).toHaveTextContent('Đã thêm Minh');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Vai trò của Lan' }), 'ADMIN');
    await waitFor(() => expect(mocks.changeWorkspaceMemberRole).toHaveBeenCalledWith('w1', 'lan', 'ADMIN'));
    expect(await screen.findByRole('status')).toHaveTextContent('Đã đổi vai trò của Lan');
    expect(screen.getByRole('combobox', { name: 'Vai trò của Lan' })).toHaveValue('ADMIN');
  });

  it('shows membership request failures and lets the user retry without a fake empty list', async () => {
    const user = userEvent.setup();
    mocks.fetchWorkspaceMembers.mockRejectedValueOnce(new Error('Mất kết nối'));
    setup('/workspaces/w1?tab=members');
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được thành viên.');
    await user.click(screen.getByRole('button', { name: 'Thử tải lại thành viên' }));
    expect(await screen.findByRole('combobox', { name: 'Vai trò của Lan' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides transfer and deletion for personal spaces while keeping collaboration available', async () => {
    const user = userEvent.setup();
    mocks.fetchWorkspace.mockResolvedValue({ ...WS, isPersonal: true });
    setup('/workspaces/w1?tab=members');
    await screen.findByRole('combobox', { name: 'Vai trò của Lan' });
    expect(screen.getByRole('button', { name: 'Mời' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Chuyển quyền/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Cài đặt' }));
    expect(screen.getByRole('textbox', { name: 'Tên không gian' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Xóa không gian' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('assignment-settings')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Nâng cao · Gợi ý phân công/ }));
    expect(screen.getByTestId('assignment-settings')).toHaveTextContent('w1');
  });

  it('supports keyboard tab navigation and saves the team name with visible feedback', async () => {
    const user = userEvent.setup();
    setup();
    const boardsTab = await screen.findByRole('tab', { name: 'Bảng & tiến độ' });
    boardsTab.focus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Cài đặt' })).toHaveFocus();
    expect(screen.getByTestId('location')).toHaveTextContent('?tab=settings');
    const name = screen.getByRole('textbox', { name: 'Tên không gian' });
    await user.clear(name);
    await user.type(name, 'Tên mới');
    await user.click(screen.getByRole('button', { name: 'Lưu tên' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Đã cập nhật tên');
    expect(mocks.updateWorkspace).toHaveBeenCalledWith('w1', 'Tên mới');
    expect(screen.getByRole('heading', { name: 'Tên mới' })).toBeInTheDocument();
    expect(mocks.reloadBoards).toHaveBeenCalled();
  });

  it('confirms removing a member and reports the server failure without removing the row', async () => {
    const user = userEvent.setup();
    mocks.removeWorkspaceMember.mockRejectedValueOnce(new Error('Không thể xóa'));
    setup('/workspaces/w1?tab=members');
    await user.click(await screen.findByRole('button', { name: 'Xóa Lan khỏi không gian' }));
    const dialog = screen.getByRole('dialog');
    expect(mocks.removeWorkspaceMember).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Xóa thành viên' }));
    await waitFor(() => expect(mocks.removeWorkspaceMember).toHaveBeenCalledWith('w1', 'lan'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không xóa được thành viên.');
    expect(screen.getByRole('combobox', { name: 'Vai trò của Lan' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps management actions unavailable to members while allowing board creation and leaving', async () => {
    const user = userEvent.setup();
    mocks.fetchWorkspace.mockResolvedValue({ ...WS, myRole: 'MEMBER' });
    setup('/workspaces/w1?tab=members');
    await screen.findByRole('heading', { name: /Thành viên \(/ });
    expect(screen.queryByRole('textbox', { name: 'Mời thành viên bằng email' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Vai trò của Lan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Xóa Lan|Chuyển quyền/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Cài đặt' }));
    expect(screen.getByRole('textbox', { name: 'Tên không gian' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rời khỏi không gian' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xóa không gian' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Bảng & tiến độ' }));
    expect(screen.getByRole('button', { name: 'Tạo bảng mới' })).toBeEnabled();
  });
});
