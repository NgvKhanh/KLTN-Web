import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '../types/board';
import BoardSidebar, { BoardMobileNav } from './BoardSidebar';

const mocks = vi.hoisted(() => ({
  boards: [] as Board[],
  isLoading: false,
  error: null as string | null,
  reload: vi.fn(),
  upsertBoard: vi.fn(),
  workspaces: [] as { id: string; name: string; isPersonal: boolean }[],
  currentWorkspaceId: 'personal' as string | null,
}));

vi.mock('../context/BoardsContext', () => ({
  useBoards: () => ({
    boards: mocks.boards,
    isLoading: mocks.isLoading,
    error: mocks.error,
    reload: mocks.reload,
    upsertBoard: mocks.upsertBoard,
  }),
}));
vi.mock('../context/WorkspacesContext', () => ({
  useWorkspaces: () => ({
    workspaces: mocks.workspaces,
    isLoading: false,
    currentWorkspaceId: mocks.currentWorkspaceId,
  }),
}));
// Hộp tạo bảng thật gọi API ảnh nền; ở đây chỉ cần biết nó được mở đúng không gian và báo kết quả lên.
vi.mock('./board/CreateBoardDialog', () => ({
  default: ({ workspaceId, onCreated }: { workspaceId?: string; onCreated: (board: Board) => void }) => (
    <div data-testid="create-dialog" data-workspace={workspaceId ?? ''}>
      <button type="button" onClick={() => onCreated(board('b9', 'Bảng mới', false, 'team'))}>Xác nhận tạo</button>
    </div>
  ),
}));

function board(id: string, name: string, isStarred = false, workspaceId = 'team'): Board {
  return {
    id, name, isStarred, workspaceId, workspaceName: 'Nhóm nghiên cứu',
    ownerId: 'u1', color: '#06b6d4', backgroundImage: null, visibility: 'WORKSPACE',
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  };
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderSidebar(mobileClose?: () => void) {
  return render(
    <MemoryRouter initialEntries={['/boards/b1']}>
      <Where />
      <Routes>
        <Route path="/boards/:boardId" element={mobileClose
          ? <BoardMobileNav open onClose={mobileClose} />
          : <BoardSidebar />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.boards = [
    board('b1', 'Đề án tốt nghiệp', true),
    board('b2', 'Kế hoạch Marketing'),
    board('b3', 'Việc nhà', false, 'personal'),
  ];
  mocks.workspaces = [
    { id: 'personal', name: 'Cá nhân', isPersonal: true },
    { id: 'team', name: 'Nhóm nghiên cứu', isPersonal: false },
  ];
  // Không gian chọn chung khác với không gian của bảng đang mở
  mocks.currentWorkspaceId = 'personal';
  mocks.isLoading = false;
  mocks.error = null;
  mocks.reload.mockReset();
  mocks.upsertBoard.mockReset();
});

describe('BoardSidebar', () => {
  it('has the main navigation, and groups boards under the workspace of the open board', () => {
    renderSidebar();
    const main = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    expect(within(main).getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('href', '/home');
    expect(within(main).getByRole('link', { name: 'Công việc của tôi' })).toHaveAttribute('href', '/my-cards');
    expect(within(main).getByRole('link', { name: 'Lịch' })).toHaveAttribute('href', '/calendar');
    expect(within(main).getByRole('link', { name: 'Tất cả bảng' })).not.toHaveAttribute('aria-current');
    expect(within(main).queryByRole('link', { name: 'Tìm kiếm nâng cao' })).not.toBeInTheDocument();

    // Nhóm của bảng đang mở mở sẵn, dù không gian chọn chung là "Cá nhân"
    expect(screen.getByRole('button', { name: 'Nhóm nghiên cứu' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Cá nhân' })).toHaveAttribute('aria-expanded', 'false');
    const team = screen.getByRole('group', { name: 'Nhóm nghiên cứu' });
    expect(within(team).getByRole('link', { name: 'Đề án tốt nghiệp' })).toHaveAttribute('aria-current', 'page');
    expect(within(team).getByRole('link', { name: 'Kế hoạch Marketing' })).not.toHaveAttribute('aria-current');
    expect(within(team).getByRole('link', { name: 'Quản lý không gian' })).toHaveAttribute('href', '/workspaces/team');
  });

  it('lists starred boards in their own section', () => {
    renderSidebar();
    const starred = screen.getByRole('region', { name: 'Yêu thích' });
    expect(within(starred).getByRole('link', { name: 'Đề án tốt nghiệp' })).toBeInTheDocument();
    expect(within(starred).queryByRole('link', { name: 'Kế hoạch Marketing' })).not.toBeInTheDocument();
  });

  it('opens and closes a workspace group, remembers it, and always reopens the group of the open board', async () => {
    const user = userEvent.setup();
    const { unmount } = renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Cá nhân' }));
    expect(screen.getByRole('button', { name: 'Cá nhân' })).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Nhóm nghiên cứu' }));
    expect(screen.getByRole('button', { name: 'Nhóm nghiên cứu' })).toHaveAttribute('aria-expanded', 'false');
    unmount();

    // Vào lại bảng: nhóm đã mở vẫn mở; nhóm chứa bảng đang xem mở lại để thấy mình đang ở đâu
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Cá nhân' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Nhóm nghiên cứu' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('finds Vietnamese board names without accents and restores the list when cleared', async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(screen.queryByRole('textbox', { name: 'Tìm bảng' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tìm bảng' }));
    await user.type(screen.getByRole('textbox', { name: 'Tìm bảng' }), 'viec nha');
    // Đang tìm thì mọi nhóm có kết quả đều mở
    expect(screen.getByRole('link', { name: 'Việc nhà' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Kế hoạch Marketing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nhóm nghiên cứu' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));
    expect(screen.getByRole('link', { name: 'Kế hoạch Marketing' })).toBeInTheDocument();
  });

  it('closes the search box on Escape and shows the whole list again', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Tìm bảng' }));
    await user.type(screen.getByRole('textbox', { name: 'Tìm bảng' }), 'Marketing');
    expect(screen.queryByRole('link', { name: 'Việc nhà' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Tìm bảng' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cá nhân' })).toBeInTheDocument();
  });

  it('distinguishes no search results from loading, empty and failed requests', async () => {
    const user = userEvent.setup();
    const { unmount } = renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Tìm bảng' }));
    await user.type(screen.getByRole('textbox', { name: 'Tìm bảng' }), 'xyz');
    expect(screen.getByRole('status')).toHaveTextContent('Không tìm thấy bảng');
    unmount();
    mocks.boards = [];
    mocks.isLoading = true;
    const loading = renderSidebar();
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải các bảng');
    expect(screen.queryByText('Chưa có bảng nào.')).not.toBeInTheDocument();
    loading.unmount();
    mocks.isLoading = false;
    const empty = renderSidebar();
    expect(screen.getByRole('status')).toHaveTextContent('Chưa có bảng nào');
    empty.unmount();
    mocks.error = 'Không tải được danh sách bảng.';
    renderSidebar();
    expect(screen.getByRole('alert')).toHaveTextContent(mocks.error);
    expect(screen.queryByText('Chưa có bảng nào.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it('puts boards of an unknown workspace in the shared group', () => {
    mocks.boards = [board('b1', 'Đề án tốt nghiệp', false, 'team'), board('x1', 'Bảng được mời', false, 'outside')];
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Được chia sẻ với bạn' })).toBeInTheDocument();
    const shared = screen.getByRole('group', { name: 'Được chia sẻ với bạn' });
    expect(within(shared).getByRole('link', { name: 'Bảng được mời' })).toBeInTheDocument();
    expect(within(shared).queryByRole('link', { name: 'Quản lý không gian' })).not.toBeInTheDocument();
  });

  it('shrinks to an icon rail and back, remembering the choice', async () => {
    const user = userEvent.setup();
    const { unmount } = renderSidebar();
    expect(screen.getByRole('complementary', { name: 'Điều hướng bảng' })).toHaveClass('w-64');
    await user.click(screen.getByRole('button', { name: 'Thu gọn' }));
    expect(screen.getByRole('complementary', { name: 'Điều hướng bảng' })).toHaveClass('w-14');
    // Dải hẹp vẫn đủ lối đi: điều hướng chính + bảng của không gian đang mở + yêu thích
    expect(screen.getByRole('link', { name: 'Công việc của tôi' })).toHaveAttribute('href', '/my-cards');
    expect(screen.getByRole('link', { name: 'Đề án tốt nghiệp' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Kế hoạch Marketing' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Việc nhà' })).not.toBeInTheDocument();
    unmount();

    renderSidebar();
    expect(screen.getByRole('complementary', { name: 'Điều hướng bảng' })).toHaveClass('w-14');
    await user.click(screen.getByRole('button', { name: 'Mở rộng thanh bên' }));
    expect(screen.getByRole('complementary', { name: 'Điều hướng bảng' })).toHaveClass('w-64');
  });

  it('creates a board in the workspace of the open board and goes to it', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Tạo bảng mới' }));
    const dialog = await screen.findByTestId('create-dialog');
    expect(dialog).toHaveAttribute('data-workspace', 'team');
    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận tạo' }));
    expect(mocks.upsertBoard).toHaveBeenCalledWith(expect.objectContaining({ id: 'b9' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/boards/b9');
    expect(screen.queryByTestId('create-dialog')).not.toBeInTheDocument();
  });

  it('closes the create dialog on Escape without touching the sidebar', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Tạo bảng mới' }));
    expect(await screen.findByTestId('create-dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('create-dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tạo bảng mới' })).toBeInTheDocument();
  });

  it('keeps the mobile drawer open when Escape closes search, and closes on navigation', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderSidebar(onClose);
    const drawer = screen.getByRole('dialog', { name: 'Điều hướng' });
    expect(within(drawer).queryByRole('button', { name: 'Thu gọn' })).not.toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Tìm bảng' }));
    await user.type(within(drawer).getByRole('textbox', { name: 'Tìm bảng' }), 'de an');
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(drawer).getAllByRole('link', { name: 'Đề án tốt nghiệp' })[0]!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes the mobile drawer after creating a board', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderSidebar(onClose);
    await user.click(screen.getByRole('button', { name: 'Tạo bảng mới' }));
    await user.click(screen.getByRole('button', { name: 'Xác nhận tạo' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByTestId('where')).toHaveTextContent('/boards/b9');
  });
});
