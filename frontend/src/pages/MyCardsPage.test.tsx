import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyCard } from '../lib/api/card';
import MyCardsPage from './MyCardsPage';

const mocks = vi.hoisted(() => ({ fetchMyCards: vi.fn(), updateCard: vi.fn() }));
vi.mock('../lib/api/card', () => ({ fetchMyCards: mocks.fetchMyCards, updateCard: mocks.updateCard }));

const NOW = new Date(2026, 9, 14, 12, 0, 0);
const due = (day: number, hour = 9, month = 9) => new Date(2026, month, day, hour, 0, 0).toISOString();

function card(id: string, title: string, over: Partial<MyCard> = {}, board = { id: 'b1', name: 'Talk show', color: '#4f46e5' }): MyCard {
  return {
    id,
    title,
    isDone: false,
    status: 'IN_PROGRESS',
    startDate: null,
    dueDate: null,
    completedAt: null,
    coverColor: null,
    list: { id: `l-${board.id}`, name: 'Đang thực hiện', status: 'IN_PROGRESS', boardId: board.id, board },
    labels: [],
    ...over,
  };
}

const CARDS: MyCard[] = [
  card('c1', 'Lấy báo giá âm thanh', { dueDate: due(10) }),
  card('c2', 'Chốt khách mời', { dueDate: due(14, 18), labels: [{ labelId: 'x', label: { id: 'x', boardId: 'b1', name: 'Gấp', color: '#ef4444' } }] }),
  card('c3', 'Duyệt kịch bản', { dueDate: due(18) }, { id: 'b2', name: 'Khởi nghiệp', color: '#059669' }),
  card('c4', 'Viết biên bản', { dueDate: due(5, 9, 10) }),
  card('c5', 'Việc chưa có hạn'),
  card('c6', 'Đã xong từ lâu', { isDone: true, status: 'DONE', dueDate: due(1) }),
];

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/my-cards']}>
      <Where />
      <Routes>
        <Route path="/my-cards" element={<MyCardsPage />} />
        <Route path="/boards/:boardId" element={<p>Trang bảng</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  mocks.fetchMyCards.mockResolvedValue(CARDS);
  mocks.updateCard.mockResolvedValue({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('MyCardsPage', () => {
  it('có tiêu đề, tóm tắt số thẻ mở / quá hạn, các nhóm theo hạn và ẩn thẻ đã xong', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Công việc của tôi' })).toBeInTheDocument();
    expect(screen.getByText(/5 thẻ đang mở/)).toBeInTheDocument();
    expect(screen.getByText('1 quá hạn')).toBeInTheDocument();
    for (const name of ['Quá hạn', 'Hôm nay', 'Trong 7 ngày tới', 'Sau này', 'Chưa đặt hạn']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(screen.queryByText('Đã xong từ lúc lâu')).not.toBeInTheDocument();
    expect(screen.queryByText('Đã xong từ lâu')).not.toBeInTheDocument();
  });

  it('mỗi dòng ghi bảng, cột, ngày hạn và mức quá hạn; bấm vào tên thẻ mở ĐÚNG thẻ ở bảng', async () => {
    const user = userEvent.setup();
    renderPage();
    const overdue = await screen.findByRole('region', { name: 'Quá hạn' });
    expect(within(overdue).getByText('Talk show')).toBeInTheDocument();
    expect(within(overdue).getByText('Đang thực hiện')).toBeInTheDocument();
    expect(within(overdue).getByText('10/10/2026')).toBeInTheDocument();
    expect(within(overdue).getByText('Quá hạn 4 ngày')).toBeInTheDocument();
    const today = screen.getByRole('region', { name: 'Hôm nay' });
    expect(within(today).getByText('Gấp')).toBeInTheDocument();
    expect(within(today).getByText('Hôm nay', { selector: 'span.block' })).toBeInTheDocument();

    await user.click(within(overdue).getByRole('link', { name: 'Lấy báo giá âm thanh' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/boards/b1?card=c1');
  });

  it('lọc theo tên (không phân biệt dấu) và theo bảng; không khớp thì có nút bỏ bộ lọc', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByRole('searchbox', { name: 'Lọc theo tên thẻ' }), 'khach moi');
    expect(screen.getByRole('link', { name: 'Chốt khách mời' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Lấy báo giá âm thanh' })).not.toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: 'Lọc theo tên thẻ' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lọc theo bảng' }), 'b2');
    expect(screen.getByRole('link', { name: 'Duyệt kịch bản' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Chốt khách mời' })).not.toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Lọc theo tên thẻ' }), 'zzz');
    expect(screen.getByText('Không có thẻ nào khớp bộ lọc.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bỏ bộ lọc' }));
    expect(screen.getByRole('link', { name: 'Chốt khách mời' })).toBeInTheDocument();
  });

  it('thu gọn / mở nhóm; hiện lại thẻ đã hoàn thành', async () => {
    const user = userEvent.setup();
    renderPage();
    const toggle = await screen.findByRole('button', { name: /Quá hạn/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Lấy báo giá âm thanh' })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByRole('link', { name: 'Lấy báo giá âm thanh' })).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Ẩn thẻ đã hoàn thành' }));
    expect(screen.getByRole('link', { name: 'Đã xong từ lâu' })).toBeInTheDocument();
  });

  it('đánh dấu hoàn thành ngay trên dòng: gọi API, thẻ rời danh sách; lỗi thì hoàn lại và báo', async () => {
    const user = userEvent.setup();
    // lần tải đầu: như cũ; lần tải lại sau khi đánh dấu: máy chủ đã ghi nhận thẻ xong
    mocks.fetchMyCards
      .mockResolvedValueOnce(CARDS)
      .mockResolvedValue(CARDS.map((c) => (c.id === 'c5' ? { ...c, isDone: true, status: 'DONE' as const } : c)));
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: 'Đánh dấu hoàn thành thẻ Việc chưa có hạn' }));
    expect(mocks.updateCard).toHaveBeenCalledWith('c5', { isDone: true });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Việc chưa có hạn' })).not.toBeInTheDocument());

    mocks.updateCard.mockRejectedValueOnce(new Error('boom'));
    await user.click(screen.getByRole('checkbox', { name: 'Đánh dấu hoàn thành thẻ Viết biên bản' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Viết biên bản' })).toBeInTheDocument();
  });

  it('huy hiệu trạng thái chỉ hiện khi thẻ lệch trạng thái của cột', async () => {
    mocks.fetchMyCards.mockResolvedValue([
      card('d1', 'Thẻ lệch cột', { status: 'BLOCKED', dueDate: due(20) }),
      card('d2', 'Thẻ đúng cột', { status: 'IN_PROGRESS', dueDate: due(21) }),
    ]);
    renderPage();
    const bad = (await screen.findByRole('link', { name: 'Thẻ lệch cột' })).closest('li') as HTMLElement;
    expect(within(bad).getByText('Bị chặn')).toBeInTheDocument();
    const ok = screen.getByRole('link', { name: 'Thẻ đúng cột' }).closest('li') as HTMLElement;
    expect(within(ok).queryByText('Đang làm')).not.toBeInTheDocument();
  });

  it('chưa có thẻ nào → trạng thái trống có đường dẫn tới các bảng', async () => {
    mocks.fetchMyCards.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Bạn chưa được gán vào thẻ nào.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem các bảng' })).toHaveAttribute('href', '/boards');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});
