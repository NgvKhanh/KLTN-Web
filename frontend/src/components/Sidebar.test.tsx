import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '../types/board';
import Sidebar from './Sidebar';

const mocks = vi.hoisted(() => ({
  setCurrentWorkspaceId: vi.fn(),
  current: 'ws1' as string | null,
}));

const BOARD = (over: Partial<Board>): Board => ({
  id: 'b1',
  ownerId: 'u1',
  workspaceId: 'ws1',
  name: 'Sprint 1',
  color: '#519839',
  backgroundImage: null,
  visibility: 'WORKSPACE',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-02T00:00:00Z',
  ...over,
});

vi.mock('../context/BoardsContext', () => ({
  useBoards: () => ({
    boards: [
      BOARD({ id: 'b1', name: 'Sprint 1', workspaceId: 'ws1', isStarred: true }),
      BOARD({ id: 'b2', name: 'Kế hoạch quý', workspaceId: 'ws2' }),
    ],
  }),
}));
vi.mock('../context/WorkspacesContext', () => ({
  useWorkspaces: () => ({
    workspaces: [
      { id: 'ws1', name: 'Nhóm Web' },
      { id: 'ws2', name: 'Cá nhân' },
    ],
    currentWorkspaceId: mocks.current,
    setCurrentWorkspaceId: mocks.setCurrentWorkspaceId,
  }),
}));

function renderSidebar(path = '/boards') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.setCurrentWorkspaceId.mockClear();
  mocks.current = 'ws1';
});

describe('Sidebar - điều hướng chính', () => {
  it('có đủ năm mục, đúng đích đến, trong đó "Công việc của tôi" và "Lịch" đã ra ngoài menu tài khoản', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    const items = within(nav).getAllByRole('link');
    expect(items.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Tổng quan', '/home'],
      ['Công việc của tôi', '/my-cards'],
      ['Lịch', '/calendar'],
      ['Tất cả bảng', '/boards'],
      ['Mẫu', '/templates'],
    ]);
  });

  it('mục đang ở được đánh dấu bằng aria-current', () => {
    renderSidebar('/calendar');
    expect(screen.getByRole('link', { name: 'Lịch' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tổng quan' })).not.toHaveAttribute('aria-current');
  });

  it('"Tất cả bảng" không sáng lên khi đang ở trang con của /boards', () => {
    renderSidebar('/boards/b1');
    expect(screen.getByRole('link', { name: 'Tất cả bảng' })).not.toHaveAttribute('aria-current');
  });

  it('bảng yêu thích hiện riêng phía trên các không gian', () => {
    renderSidebar();
    expect(screen.getByText('Yêu thích')).toBeInTheDocument();
  });
});

describe('Sidebar - cây không gian làm việc', () => {
  it('mặc định chỉ không gian đang chọn được mở; phần đóng không nhận focus (inert)', () => {
    renderSidebar();
    const open = screen.getByRole('button', { name: 'Thu gọn Nhóm Web' });
    const closed = screen.getByRole('button', { name: 'Mở rộng Cá nhân' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(closed).toHaveAttribute('aria-expanded', 'false');
    const closedPanel = document.getElementById(closed.getAttribute('aria-controls')!)!;
    expect(closedPanel.querySelector('[inert]')).not.toBeNull();
    const openPanel = document.getElementById(open.getAttribute('aria-controls')!)!;
    expect(openPanel.querySelector('[inert]')).toBeNull();
  });

  it('bấm mũi tên đóng/mở mà KHÔNG đổi không gian đang chọn, và nhớ lại lần sau', async () => {
    const user = userEvent.setup();
    const { unmount } = renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Mở rộng Cá nhân' }));
    expect(screen.getByRole('button', { name: 'Thu gọn Cá nhân' })).toHaveAttribute('aria-expanded', 'true');
    expect(mocks.setCurrentWorkspaceId).not.toHaveBeenCalled();
    unmount();
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Thu gọn Cá nhân' })).toBeInTheDocument();
  });

  it('bấm tên không gian thì chọn nó và mở ra', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByText('Cá nhân'));
    expect(mocks.setCurrentWorkspaceId).toHaveBeenCalledWith('ws2');
    expect(screen.getByRole('button', { name: 'Thu gọn Cá nhân' })).toBeInTheDocument();
  });

  it('trình duyệt chặn lưu trữ vẫn dùng được', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Mở rộng Cá nhân' }));
    expect(screen.getByRole('button', { name: 'Thu gọn Cá nhân' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
