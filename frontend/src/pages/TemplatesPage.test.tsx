import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardTemplate } from '../lib/api/board';
import type { UserBoardTemplate } from '../types/boardTemplate';
import TemplatesPage from './TemplatesPage';

const mocks = vi.hoisted(() => ({
  fetchTemplates: vi.fn(),
  createBoardFromTemplate: vi.fn(),
  fetchUserBoardTemplates: vi.fn(),
  createBoardFromUserTemplate: vi.fn(),
  deleteUserBoardTemplate: vi.fn(),
  upsertBoard: vi.fn(),
  workspaces: [
    { id: 'w1', name: 'Không gian của tôi' },
    { id: 'w2', name: 'Ban tổ chức' },
  ],
}));

vi.mock('../lib/api/board', () => ({ fetchTemplates: mocks.fetchTemplates, createBoardFromTemplate: mocks.createBoardFromTemplate }));
vi.mock('../lib/api/boardTemplate', () => ({
  fetchUserBoardTemplates: mocks.fetchUserBoardTemplates,
  createBoardFromUserTemplate: mocks.createBoardFromUserTemplate,
  deleteUserBoardTemplate: mocks.deleteUserBoardTemplate,
}));
vi.mock('../context/BoardsContext', () => ({ useBoards: () => ({ upsertBoard: mocks.upsertBoard }) }));
vi.mock('../context/WorkspacesContext', () => ({ useWorkspaces: () => ({ workspaces: mocks.workspaces, currentWorkspaceId: 'w1' }) }));

const TEMPLATES: BoardTemplate[] = [
  {
    id: 'kanban',
    name: 'Kanban cơ bản',
    description: 'Ba cột đơn giản để theo dõi công việc hằng ngày.',
    category: 'work',
    color: '#0079BF',
    lists: [
      { name: 'Cần làm', status: 'TODO', cards: ['Ví dụ: Lên kế hoạch tuần'] },
      { name: 'Đang làm', status: 'IN_PROGRESS', cards: [] },
      { name: 'Hoàn thành', status: 'DONE', cards: [] },
    ],
  },
  {
    id: 'bugs',
    name: 'Theo dõi lỗi',
    description: 'Ghi nhận, xác nhận và sửa lỗi.',
    category: 'dev',
    color: '#B04632',
    labels: [{ name: 'Nghiêm trọng', color: '#EB5A46' }],
    lists: [
      { name: 'Mới báo', status: 'TODO', cards: ['Nút Đăng nhập không phản hồi'] },
      { name: 'Đã sửa', status: 'DONE', cards: [] },
    ],
  },
  {
    id: 'travel',
    name: 'Kế hoạch du lịch',
    description: 'Gom địa điểm và đặt chỗ.',
    category: 'life',
    color: '#0079BF',
    lists: [
      { name: 'Địa điểm muốn đi', status: null, cards: ['Đà Lạt'] },
      { name: 'Đã đặt', status: 'DONE', cards: [] },
    ],
  },
];
const CATEGORIES = [
  { id: 'work', name: 'Công việc' },
  { id: 'dev', name: 'Phần mềm' },
  { id: 'life', name: 'Cá nhân' },
];
const MINE: UserBoardTemplate[] = [
  {
    id: 'u1',
    workspaceId: 'w1',
    name: 'Bảng nhóm của tôi (mẫu)',
    color: '#519839',
    createdById: 'me',
    createdAt: '2026-10-01T00:00:00.000Z',
    createdBy: { id: 'me', name: 'Khanh', avatarUrl: null },
    lists: [{ id: 'l1', name: 'Việc nhóm', position: 0, status: 'TODO', cards: [{ id: 'c1', title: 'Họp tuần', description: null, position: 0 }] }],
  },
];

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/templates']}>
      <Where />
      <Routes>
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/boards/:boardId" element={<p>Trang bảng</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchTemplates.mockResolvedValue({ templates: TEMPLATES, categories: CATEGORIES });
  mocks.fetchUserBoardTemplates.mockResolvedValue(MINE);
  mocks.createBoardFromTemplate.mockResolvedValue({ id: 'new-board', name: 'x' });
  mocks.createBoardFromUserTemplate.mockResolvedValue({ id: 'new-user-board', name: 'x' });
  mocks.deleteUserBoardTemplate.mockResolvedValue(undefined);
});

describe('TemplatesPage', () => {
  it('nhóm mẫu theo loại, có "Mẫu của bạn" ở đầu, mỗi mẫu ghi số cột và thẻ ví dụ', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Mẫu bảng' })).toBeInTheDocument();
    const names = (await screen.findAllByRole('heading', { level: 2 })).map((h) => h.textContent?.replace(/\d+$/, '').trim());
    expect(names).toEqual(['Mẫu của bạn', 'Công việc', 'Phần mềm', 'Cá nhân']);
    const work = screen.getByRole('region', { name: 'Công việc' });
    expect(within(work).getByText('Kanban cơ bản')).toBeInTheDocument();
    expect(within(work).getByText('3 cột · 1 thẻ ví dụ')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Mẫu của bạn' })).toHaveTextContent('Do Khanh lưu từ một bảng có sẵn.');
  });

  it('lọc theo nhóm và tìm theo tên / cột / thẻ / nhãn không phân biệt dấu', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('region', { name: 'Công việc' });
    await user.click(screen.getByRole('button', { name: 'Phần mềm' }));
    expect(screen.queryByRole('region', { name: 'Công việc' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Phần mềm' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tất cả' }));
    await user.type(screen.getByRole('searchbox', { name: 'Tìm mẫu' }), 'nghiem trong');
    expect(screen.getByRole('button', { name: 'Xem mẫu Theo dõi lỗi' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xem mẫu Kanban cơ bản' })).not.toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: 'Tìm mẫu' }));
    await user.type(screen.getByRole('searchbox', { name: 'Tìm mẫu' }), 'khong co mau nao');
    expect(screen.getByText('Không có mẫu nào khớp.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bỏ bộ lọc' }));
    expect(screen.getByRole('button', { name: 'Xem mẫu Kanban cơ bản' })).toBeInTheDocument();
  });

  it('"Dùng mẫu" tạo ngay bảng bằng tên mặc định trong không gian đang chọn rồi mở bảng', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Dùng mẫu Kanban cơ bản' }));
    expect(mocks.createBoardFromTemplate).toHaveBeenCalledWith('kanban', 'w1', undefined);
    expect(mocks.upsertBoard).toHaveBeenCalledWith({ id: 'new-board', name: 'x' });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/boards/new-board'));
  });

  it('bấm vào mẫu mở chi tiết: đủ cột + thẻ + nhãn; đặt tên riêng và chọn không gian rồi tạo', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Xem mẫu Theo dõi lỗi' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Theo dõi lỗi' })).toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: 'Cột Mới báo' })).toHaveTextContent('Nút Đăng nhập không phản hồi');
    expect(within(dialog).getByRole('region', { name: 'Cột Đã sửa' })).toHaveTextContent('Chưa có thẻ');
    expect(within(dialog).getByText('Nghiêm trọng')).toBeInTheDocument();

    const nameBox = within(dialog).getByRole('textbox', { name: 'Tên bảng' });
    expect(nameBox).toHaveValue('Theo dõi lỗi');
    await user.clear(nameBox);
    await user.type(nameBox, 'Lỗi của app di động');
    await user.selectOptions(within(dialog).getByRole('combobox'), 'w2');
    await user.click(within(dialog).getByRole('button', { name: 'Tạo bảng' }));
    expect(mocks.createBoardFromTemplate).toHaveBeenCalledWith('bugs', 'w2', 'Lỗi của app di động');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/boards/new-board'));
  });

  it('đóng chi tiết bằng Esc; lỗi khi tạo hiện ngay trong hộp chi tiết', async () => {
    const user = userEvent.setup();
    mocks.createBoardFromTemplate.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Xem mẫu Kế hoạch du lịch' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Tạo bảng' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('mẫu của bạn: "Dùng mẫu" gọi API riêng của mẫu đã lưu (không phải mẫu có sẵn)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Dùng mẫu Bảng nhóm của tôi (mẫu)' }));
    expect(mocks.createBoardFromUserTemplate).toHaveBeenCalledWith('w1', 'u1', undefined);
  });

  it('xoá mẫu của bạn: hỏi xác nhận, đồng ý thì gọi API và mẫu biến mất', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Xoá mẫu Bảng nhóm của tôi (mẫu)' }));
    expect(mocks.deleteUserBoardTemplate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Xoá mẫu' }));
    await waitFor(() => expect(mocks.deleteUserBoardTemplate).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Mẫu của bạn' })).not.toBeInTheDocument());
  });
});
