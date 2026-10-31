import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyActivity } from '../lib/api/auth';
import MyActivityPage from './MyActivityPage';

const mocks = vi.hoisted(() => ({ fetchMyActivity: vi.fn() }));
vi.mock('../lib/api/auth', () => ({ fetchMyActivity: mocks.fetchMyActivity }));

const NOW = new Date(2026, 9, 12, 14, 0, 0);
const at = (day: number, hour = 9, minute = 0) => new Date(2026, 9, day, hour, minute, 0).toISOString();
const board = { id: 'b1', name: 'Talk show' };

function act(id: string, type: string, createdAt: string, data: Record<string, string> = {}, over: Partial<MyActivity> = {}): MyActivity {
  return { id, type, data, createdAt, board, card: { id: `c-${id}`, title: `Thẻ ${id}`, deleted: false }, ...over };
}

const FIRST: MyActivity[] = [
  act('a1', 'card.status', at(12, 13, 22), { from: 'TODO', to: 'IN_REVIEW' }),
  act('a2', 'card.move', at(12, 9, 5), { fromList: '1.', toList: '3' }),
  act('a3', 'comment.create', at(11, 22, 40), { text: 'Đã review xong' }),
  act('a4', 'card.done', at(6, 10, 0), {}, { board: { id: 'b2', name: 'Khởi nghiệp' } }),
  act('a5', 'card.create', at(6, 9, 0), { listName: 'Cần làm' }, { card: { id: 'c-a5', title: 'Thẻ đã xoá', deleted: true } }),
];

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/activity']}>
      <Where />
      <Routes>
        <Route path="/activity" element={<MyActivityPage />} />
        <Route path="/boards/:boardId" element={<p>Trang bảng</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  mocks.fetchMyActivity.mockResolvedValue({ activities: FIRST, hasMore: false });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('MyActivityPage', () => {
  it('gom theo ngày; mỗi dòng có câu mô tả, tên thẻ, bảng, giờ', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Hoạt động của tôi' })).toBeInTheDocument();
    const days = (await screen.findAllByRole('heading', { level: 2 })).map((h) => h.textContent);
    expect(days).toEqual(['Hôm nay', 'Hôm qua', 'Thứ ba, 06/10/2026']);

    const today = screen.getByRole('region', { name: 'Hôm nay' });
    const status = within(today).getAllByRole('listitem')[0];
    expect(status).toHaveTextContent('Đổi trạng thái thẻ “Thẻ a1” từ “Chưa làm” sang “Chờ duyệt”');
    expect(status).toHaveTextContent('Talk show');
    expect(within(status).getByText('13:22')).toBeInTheDocument();
    expect(within(today).getAllByRole('listitem')[1]).toHaveTextContent('Chuyển thẻ “Thẻ a2” từ 1. sang 3');
    // không còn câu hỏng kiểu "thẻ thẻ"
    expect(document.body.textContent).not.toMatch(/thẻ thẻ/i);
    expect(screen.getByRole('region', { name: 'Hôm qua' })).toHaveTextContent('Đã review xong');
  });

  it('tên thẻ là liên kết mở đúng thẻ; thẻ đã xoá chỉ là chữ kèm "(đã xoá)"', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('link', { name: '“Thẻ a1”' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/boards/b1?card=c-a1');
  });

  it('thẻ đã xoá không có liên kết', async () => {
    renderPage();
    const day = await screen.findByRole('region', { name: 'Thứ ba, 06/10/2026' });
    expect(within(day).queryByRole('link', { name: '“Thẻ đã xoá”' })).not.toBeInTheDocument();
    expect(within(day).getByText('(đã xoá)')).toBeInTheDocument();
  });

  it('lọc theo bảng', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Lọc theo bảng' }), 'b2');
    expect(screen.getByRole('region', { name: 'Thứ ba, 06/10/2026' })).toHaveTextContent('Hoàn thành thẻ “Thẻ a4”');
    expect(screen.queryByRole('region', { name: 'Hôm nay' })).not.toBeInTheDocument();
  });

  it('"Xem thêm" tải trang tiếp theo từ mốc thời gian của dòng cuối và không trùng dòng', async () => {
    const user = userEvent.setup();
    mocks.fetchMyActivity
      .mockResolvedValueOnce({ activities: FIRST, hasMore: true })
      .mockResolvedValueOnce({ activities: [FIRST[4], act('a6', 'card.rename', at(5, 8, 0), { from: 'Cũ', to: 'Mới' })], hasMore: false });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Xem thêm' }));
    expect(mocks.fetchMyActivity).toHaveBeenLastCalledWith(FIRST[4].createdAt);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Thứ hai, 05/10/2026' })).toHaveTextContent('Đổi tên thẻ “Thẻ a6” (trước đó: “Cũ”)'));
    expect(screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('Tạo thẻ “Thẻ đã xoá”'))).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).not.toBeInTheDocument();
  });

  it('chưa có hoạt động nào → trạng thái trống; lỗi tải → báo lỗi', async () => {
    mocks.fetchMyActivity.mockResolvedValueOnce({ activities: [], hasMore: false });
    const { unmount } = renderPage();
    expect(await screen.findByText('Chưa có hoạt động nào.')).toBeInTheDocument();
    unmount();

    mocks.fetchMyActivity.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Không tải được hoạt động.')).toBeInTheDocument();
  });
});
