import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardPlan, GeneratePlanResult } from '../types/ai';
import type { Board } from '../types/board';
import { CreateBoardMenu } from './Header';

// Tich hop: menu "Tao moi" trong Header + popover + modal AI. Kiem chung THIET KE "modal la ANH EM cua
// popover": popover tu dong khi bam ra ngoai vung cua no, con modal (portal) nam ngoai vung do.

const mocks = vi.hoisted(() => ({
  upsertBoard: vi.fn(),
  createBoard: vi.fn(),
  fetchAiStatus: vi.fn(),
  extractDocument: vi.fn(),
  generateBoardPlan: vi.fn(),
  applyBoardPlan: vi.fn(),
}));
vi.mock('../context/BoardsContext', () => ({ useBoards: () => ({ upsertBoard: mocks.upsertBoard }) }));
vi.mock('../context/WorkspacesContext', () => ({
  useWorkspaces: () => ({ workspaces: [{ id: 'ws1', name: 'Cá nhân' }], currentWorkspaceId: 'ws1' }),
}));
vi.mock('../lib/api/board', () => ({ createBoard: mocks.createBoard }));
vi.mock('../lib/api/unsplash', () => ({ trackUnsplashDownload: vi.fn() }));
vi.mock('../lib/api/ai', () => ({
  fetchAiStatus: mocks.fetchAiStatus,
  extractDocument: mocks.extractDocument,
  generateBoardPlan: mocks.generateBoardPlan,
  applyBoardPlan: mocks.applyBoardPlan,
}));
vi.mock('../lib/useUnsplashPhotos', () => ({
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

const PLAN: BoardPlan = {
  mode: 'STRUCTURED',
  board: { name: 'Kế hoạch thử', color: '#519839' },
  labels: [],
  lists: [
    {
      name: 'Việc cần làm',
      cards: [
        {
          ref: 'c1',
          title: 'Viết báo cáo',
          description: '',
          sourceLine: 1,
          selected: true,
          startDate: null,
          startOrigin: 'NONE',
          dueDate: null,
          dueOrigin: 'NONE',
          labelKeys: [],
          checklist: [],
        },
      ],
    },
  ],
  warnings: [],
  assumptions: [],
};
const RESULT: GeneratePlanResult = {
  runId: 'run-1',
  llmUsed: false,
  modeAuto: 'FREEFORM',
  plan: PLAN,
  stats: { totalCards: 1, selectedCards: 1, truncatedCards: 0, explicitCards: 0, scheduledCards: 0, undatedCards: 1 },
};
const BOARD = { id: 'board-9', name: 'Kế hoạch thử' } as Board;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.fetchAiStatus.mockResolvedValue({ llmAvailable: false, provider: 'x', model: '' });
  mocks.generateBoardPlan.mockResolvedValue(RESULT);
  mocks.applyBoardPlan.mockResolvedValue(BOARD);
});

function renderMenu() {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<CreateBoardMenu />} />
        <Route path="/boards/:id" element={<p>TRANG BẢNG</p>} />
      </Routes>
    </MemoryRouter>
  );
  return user;
}

const popoverTitle = () => screen.queryByText('Tạo bảng', { exact: true });
const modal = () => screen.queryByRole('dialog');

describe('Header - menu "Tạo mới" + modal AI', () => {
  it('bấm "Tạo bằng AI": popover ĐÓNG và modal MỞ (anh em, độc lập); bấm/nhấn chuột bên trong modal không làm gì popover; đóng modal thì mở lại popover được', async () => {
    const user = renderMenu();
    expect(popoverTitle()).not.toBeInTheDocument();
    expect(modal()).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Tạo mới/ }));
    // Hộp thoại tạo bảng và modal AI là React.lazy: chunk tải xong mới hiện
    expect(await screen.findByText('Tạo bảng', { exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Tạo bằng AI/ }));

    expect(await screen.findByRole('heading', { name: 'Tạo bảng bằng AI' })).toBeInTheDocument();
    expect(popoverTitle()).not.toBeInTheDocument();

    // mousedown ngoài vùng popover (đúng thứ làm popover tự đóng): modal vẫn ở đó và gõ được
    const box = screen.getByRole('textbox', { name: 'Mô tả công việc' });
    fireEvent.mouseDown(box);
    await user.click(box);
    await user.paste('- Viết báo cáo tuần\n- Gửi cho trưởng nhóm');
    expect(modal()).toBeInTheDocument();
    expect(box).toHaveValue('- Viết báo cáo tuần\n- Gửi cho trưởng nhóm');

    await user.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(modal()).not.toBeInTheDocument();
    expect(popoverTitle()).not.toBeInTheDocument(); // popover không tự mở lại

    await user.click(screen.getByRole('button', { name: /Tạo mới/ }));
    expect(popoverTitle()).toBeInTheDocument();
    expect(mocks.createBoard).not.toHaveBeenCalled();
  });

  it('tạo bảng từ modal: upsertBoard đúng bảng, gọi apply đúng kế hoạch, chuyển sang /boards/:id, modal biến mất', async () => {
    const user = renderMenu();
    await user.click(screen.getByRole('button', { name: /Tạo mới/ }));
    await user.click(await screen.findByRole('button', { name: /Tạo bằng AI/ }));
    await user.click(await screen.findByRole('textbox', { name: 'Mô tả công việc' }));
    await user.paste('- Viết báo cáo tuần\n- Gửi cho trưởng nhóm');
    await user.click(screen.getByRole('button', { name: 'Tạo kế hoạch' }));
    await screen.findByRole('heading', { name: 'Xem trước kế hoạch' });
    await user.click(screen.getByRole('button', { name: 'Tạo bảng (1 thẻ)' }));

    expect(await screen.findByText('TRANG BẢNG')).toBeInTheDocument();
    expect(mocks.upsertBoard).toHaveBeenCalledTimes(1);
    expect(mocks.upsertBoard).toHaveBeenCalledWith(BOARD);
    expect(mocks.applyBoardPlan).toHaveBeenCalledWith('run-1', PLAN);
    expect(modal()).not.toBeInTheDocument();
  });

  it('popover vẫn tự đóng khi bấm ra ngoài (hành vi cũ giữ nguyên); tạo bảng thường vẫn chuyển trang', async () => {
    mocks.createBoard.mockResolvedValue({ id: 'board-1', name: 'Bảng thường' });
    const user = renderMenu();
    await user.click(screen.getByRole('button', { name: /Tạo mới/ }));
    expect(popoverTitle()).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(popoverTitle()).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Tạo mới/ }));
    await user.type(screen.getByPlaceholderText('Nhập tên bảng...'), 'Bảng thường');
    // nút gửi form trong popover cũng tên "Tạo mới" như nút mở menu: chọn theo type=submit
    await user.click(screen.getAllByRole('button', { name: 'Tạo mới' }).find((b) => b.getAttribute('type') === 'submit')!);
    expect(await screen.findByText('TRANG BẢNG')).toBeInTheDocument();
    expect(mocks.upsertBoard).toHaveBeenCalledWith({ id: 'board-1', name: 'Bảng thường' });
    expect(mocks.applyBoardPlan).not.toHaveBeenCalled();
  });
});
