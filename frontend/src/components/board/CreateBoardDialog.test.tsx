import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '../../types/board';
import CreateBoardDialog from './CreateBoardDialog';

const mocks = vi.hoisted(() => ({
  createBoard: vi.fn(),
  trackUnsplashDownload: vi.fn(),
}));
vi.mock('../../lib/api/board', () => ({ createBoard: mocks.createBoard }));
vi.mock('../../lib/api/unsplash', () => ({ trackUnsplashDownload: mocks.trackUnsplashDownload }));
vi.mock('../../context/WorkspacesContext', () => ({
  useWorkspaces: () => ({ workspaces: [{ id: 'ws1', name: 'Cá nhân' }], currentWorkspaceId: 'ws1' }),
}));
// Khong goi Unsplash that: tat han (unavailable) de popover chi con o mau
vi.mock('../../lib/useUnsplashPhotos', () => ({
  useUnsplashPhotos: () => ({
    photos: [],
    loading: false,
    loadingMore: false,
    error: null,
    unavailable: true,
    search: '',
    setSearch: vi.fn(),
    loadMore: vi.fn(),
    canLoadMore: false,
    onFirstLoad: vi.fn(),
  }),
}));

const BOARD = { id: 'b1', name: 'Bảng mới' } as Board;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createBoard.mockResolvedValue(BOARD);
});

describe('CreateBoardDialog - dòng "Tạo bằng AI"', () => {
  it('chỉ hiện khi cha truyền onOpenAi; bấm thì gọi onOpenAi, KHÔNG gửi form, KHÔNG tự đóng, KHÔNG tạo bảng', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const { rerender } = render(<CreateBoardDialog onClose={onClose} onCreated={onCreated} />);
    expect(screen.queryByRole('button', { name: /Tạo bằng AI/ })).not.toBeInTheDocument();

    const onOpenAi = vi.fn();
    rerender(<CreateBoardDialog onClose={onClose} onCreated={onCreated} onOpenAi={onOpenAi} />);
    const button = screen.getByRole('button', { name: /Tạo bằng AI/ });
    expect(button).toHaveAttribute('type', 'button'); // không phải nút submit của form
    await user.type(screen.getByPlaceholderText('Nhập tên bảng...'), 'Bảng đang gõ dở');

    await user.click(button);
    expect(onOpenAi).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled(); // việc đóng popover là của cha
    expect(mocks.createBoard).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('luồng tạo bảng thường vẫn nguyên (đủ tên + không gian + màu); tên rỗng thì nút tạo bị khoá', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<CreateBoardDialog onClose={vi.fn()} onCreated={onCreated} onOpenAi={vi.fn()} />);
    const submit = screen.getByRole('button', { name: 'Tạo mới' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Nhập tên bảng...'), '  Bảng thường  ');
    await user.click(submit);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(BOARD));
    expect(mocks.createBoard).toHaveBeenCalledWith({
      name: 'Bảng thường',
      workspaceId: 'ws1',
      color: '#0079BF',
      backgroundImage: undefined,
    });
  });
});
