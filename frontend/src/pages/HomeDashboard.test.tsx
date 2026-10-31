import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyCard } from '../lib/api/card';
import type { Board } from '../types/board';
import HomeDashboard from './HomeDashboard';

const mocks = vi.hoisted(() => ({
  fetchMyCards: vi.fn(),
  updateCard: vi.fn(),
  fetchHomeActivity: vi.fn(),
  boards: [] as Board[],
}));
vi.mock('../lib/api/card', () => ({ fetchMyCards: mocks.fetchMyCards, updateCard: mocks.updateCard }));
vi.mock('../lib/api/board', () => ({ fetchHomeActivity: mocks.fetchHomeActivity }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Khanh Quoc' } }) }));
vi.mock('../context/BoardsContext', () => ({ useBoards: () => ({ boards: mocks.boards, isLoading: false }) }));
vi.mock('../components/Header', () => ({ CreateBoardMenu: () => null }));

// Giữa trưa thứ Tư 14/10/2026 theo giờ máy
const NOW = new Date(2026, 9, 14, 12, 0, 0);
const due = (day: number, hour = 9) => new Date(2026, 9, day, hour, 0, 0).toISOString();

function card(id: string, title: string, over: Partial<MyCard> = {}): MyCard {
  const board = { id: 'b1', name: 'Talk show', color: '#4f46e5' };
  return {
    id,
    title,
    isDone: false,
    status: 'IN_PROGRESS',
    startDate: null,
    dueDate: null,
    completedAt: null,
    coverColor: null,
    list: { id: 'l1', name: 'Đang thực hiện', status: 'IN_PROGRESS', boardId: board.id, board },
    labels: [],
    ...over,
  };
}

const CARDS: MyCard[] = [
  card('c1', 'Lấy báo giá âm thanh', { dueDate: due(10) }),
  card('c2', 'Chốt khách mời', { dueDate: due(14, 18) }),
  card('c3', 'Duyệt kịch bản', { dueDate: due(17) }),
  card('c4', 'Viết biên bản', { dueDate: due(30) }),
  card('c5', 'Đã xong từ trước', { isDone: true, status: 'DONE', dueDate: due(9), completedAt: due(13) }),
  card('c6', 'Xong tuần trước', { isDone: true, status: 'DONE', completedAt: due(8) }),
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <HomeDashboard />
    </MemoryRouter>
  );
}

const attention = () => screen.getByRole('heading', { name: 'Cần chú ý' }).closest('section') as HTMLElement;
const stat = (label: string) => screen.getByText(label, { selector: 'button span' }).closest('button') as HTMLElement;
const overdueStat = () => stat('Quá hạn');

function board(id: string, name: string, over: Partial<Board> = {}): Board {
  return {
    id,
    ownerId: 'u1',
    workspaceId: 'w1',
    name,
    color: '#4f46e5',
    backgroundImage: null,
    visibility: 'WORKSPACE',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    workspaceName: 'Ban tổ chức',
    cardCount: 0,
    doneCount: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  localStorage.clear();
  mocks.boards = [
    board('b1', 'Talk show', { cardCount: 70, doneCount: 49, updatedAt: '2026-10-10T00:00:00Z' }),
    board('b2', 'Marketing', { isStarred: true, cardCount: 0, updatedAt: '2026-10-12T00:00:00Z' }),
  ];
  mocks.fetchMyCards.mockResolvedValue(CARDS);
  mocks.fetchHomeActivity.mockResolvedValue([]);
  mocks.updateCard.mockResolvedValue({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Tổng quan: số liệu đầu trang', () => {
  it('mỗi ô có con số và ngữ cảnh đi kèm', async () => {
    renderPage();
    await waitFor(() => expect(within(stat('Thẻ đang mở')).getByText('4')).toBeInTheDocument());
    expect(within(stat('Thẻ đang mở')).getByText('trên 1 bảng')).toBeInTheDocument();
    expect(within(overdueStat()).getByText('1')).toBeInTheDocument();
    expect(within(overdueStat()).getByText('trễ nhất 4 ngày')).toBeInTheDocument();
    expect(within(stat('Đến hạn 7 ngày tới')).getByText('2')).toBeInTheDocument();
    expect(within(stat('Đến hạn 7 ngày tới')).getByText('gần nhất hôm nay')).toBeInTheDocument();
    expect(within(stat('Xong tuần này')).getByText('1')).toBeInTheDocument();
    expect(within(stat('Xong tuần này')).getByText('tuần trước 1')).toBeInTheDocument();
  });

  it('tải lỗi thì hiện gạch ngang, không hiện số 0', async () => {
    mocks.fetchMyCards.mockRejectedValue(new Error('500'));
    renderPage();
    await waitFor(() => expect(within(overdueStat()).getByText('–')).toBeInTheDocument());
    expect(within(overdueStat()).queryByText('0')).not.toBeInTheDocument();
  });
});

describe('Tổng quan: dải 7 ngày tới', () => {
  it('ô hôm nay có số thẻ trễ từ trước; mỗi ô ghi thẻ đến hạn ngày đó, bấm mở thẳng thẻ', async () => {
    renderPage();
    const strip = screen.getByRole('heading', { name: '7 ngày tới' }).closest('section') as HTMLElement;
    const today = await within(strip).findByRole('listitem', { name: 'Hôm nay 14/10: 1 thẻ đến hạn' });
    expect(within(today).getByRole('link', { name: '+1 quá hạn' })).toHaveAttribute('href', '/my-cards');
    expect(within(today).getByRole('link', { name: /Chốt khách mời/ })).toHaveAttribute('href', '/boards/b1?card=c2');
    const sat = within(strip).getByRole('listitem', { name: 'T7 17/10: 1 thẻ đến hạn' });
    expect(within(sat).getByRole('link', { name: /Duyệt kịch bản/ })).toHaveAttribute('href', '/boards/b1?card=c3');
    expect(within(strip).getAllByRole('listitem', { name: /thẻ đến hạn$/ })).toHaveLength(8);
    expect(within(strip).getByRole('link', { name: 'Mở lịch' })).toHaveAttribute('href', '/calendar');
  });
});

describe('Tổng quan: Bảng của bạn', () => {
  const section = () => screen.getByRole('heading', { name: 'Bảng của bạn' }).closest('section') as HTMLElement;

  it('chưa mở bảng nào thì "Gần đây" lấy bảng cập nhật gần nhất; có tiến độ và việc của mình trên từng bảng', async () => {
    renderPage();
    const box = section();
    const links = await within(box).findAllByRole('link', { name: /^(Talk show|Marketing)$/ });
    expect(links.map((l) => l.textContent)).toEqual(['Marketing', 'Talk show']);
    expect(within(box).getByRole('progressbar', { name: 'Tiến độ bảng Talk show' })).toHaveAttribute('aria-valuenow', '70');
    expect(within(box).getByText('49/70')).toBeInTheDocument();
    expect(within(box).getByText('Chưa có thẻ')).toBeInTheDocument();
    // 4 thẻ mở của mình trên Talk show, 1 quá hạn
    expect(within(box).getByText(/4 thẻ của bạn/)).toBeInTheDocument();
    expect(within(box).getByText(/1 quá hạn/)).toBeInTheDocument();
  });

  it('đổi tab: Có sao / Có việc của bạn; nhớ tab đã chọn', async () => {
    const user = userEvent.setup();
    renderPage();
    const box = section();
    await user.click(await within(box).findByRole('button', { name: 'Có sao' }));
    expect(within(box).getByRole('button', { name: 'Có sao' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(box).getByRole('link', { name: 'Marketing' })).toBeInTheDocument();
    expect(within(box).queryByRole('link', { name: 'Talk show' })).not.toBeInTheDocument();

    await user.click(within(box).getByRole('button', { name: 'Có việc của bạn' }));
    expect(within(box).getByRole('link', { name: 'Talk show' })).toHaveAttribute('href', '/boards/b1');
    expect(within(box).queryByRole('link', { name: 'Marketing' })).not.toBeInTheDocument();
    expect(localStorage.getItem('tf.home.boardTab')).toBe('mine');
  });
});

describe('Tổng quan: Bạn đã hoàn thành', () => {
  const section = () => screen.getByRole('heading', { name: 'Bạn đã hoàn thành' }).closest('section') as HTMLElement;

  it('bảng số liệu theo tuần (cho trình đọc màn hình) + tỉ lệ đúng hạn; phím mũi tên xem từng tuần', async () => {
    const user = userEvent.setup();
    renderPage();
    const box = section();
    const table = await within(box).findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(8);
    expect(rows[7]).toHaveTextContent('Tuần này (12/10 – 18/10)1');
    expect(rows[6]).toHaveTextContent('05/10 – 11/101');
    expect(rows[0]).toHaveTextContent('24/08 – 30/080');
    // c5 xong ngày 13 nhưng hạn ngày 9: trễ; c6 không có hạn nên không tính
    expect(within(box).getByText(/Đúng hạn 0\/1 thẻ có hạn/)).toBeInTheDocument();

    act(() => within(box).getByLabelText(/Biểu đồ số thẻ hoàn thành/).focus());
    expect(within(box).getByText('1 thẻ, tuần 12/10 – 18/10')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(within(box).getByText('1 thẻ, tuần 05/10 – 11/10')).toBeInTheDocument();
  });

  it('8 tuần không xong thẻ nào thì ghi một dòng thay cho biểu đồ', async () => {
    mocks.fetchMyCards.mockResolvedValue(CARDS.filter((c) => !c.isDone));
    renderPage();
    expect(await within(section()).findByText('Chưa có thẻ nào của bạn hoàn thành trong 8 tuần qua.')).toBeInTheDocument();
  });
});

describe('Tổng quan: Hoạt động gần đây', () => {
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
  const act = (
    id: string,
    user: { id: string; name: string },
    type: string,
    data: Record<string, string>,
    card: { id: string; title: string } | null,
    createdAt: string
  ) => ({ id, type, data, createdAt, user: { ...user, avatarUrl: null }, card, board: { id: 'b1', name: 'Talk show' } });
  const HA = { id: 'u2', name: 'Trần Thu Hà' };
  const ME = { id: 'u1', name: 'Khanh Quoc' };
  const ROWS = [
    act('a1', HA, 'comment.create', {}, { id: 'c1', title: 'Lấy báo giá âm thanh' }, at(14, 11, 45)),
    act('a2', ME, 'card.status', { from: 'IN_PROGRESS', to: 'REVIEW' }, { id: 'c2', title: 'Chốt khách mời' }, at(13, 16)),
    act('a3', ME, 'card.move', { fromList: 'Đang làm', toList: 'Chờ duyệt' }, { id: 'c2', title: 'Chốt khách mời' }, at(13, 15, 59)),
    act('a4', HA, 'card.create', { listName: 'Cần làm' }, { id: 'c3', title: 'Duyệt kịch bản' }, at(10, 9)),
  ];
  const section = () => screen.getByRole('heading', { name: 'Hoạt động gần đây' }).closest('section') as HTMLElement;

  it('nhóm theo ngày, việc của mình ghi "Bạn", tên thẻ mở thẳng thẻ, gộp thao tác liền nhau trên cùng thẻ', async () => {
    mocks.fetchHomeActivity.mockResolvedValue(ROWS);
    renderPage();
    const box = section();
    const today = await within(box).findByRole('region', { name: 'Hôm nay' });
    expect(within(today).getByText('Trần Thu Hà')).toBeInTheDocument();
    expect(within(today).getByRole('link', { name: 'Lấy báo giá âm thanh' })).toHaveAttribute('href', '/boards/b1?card=c1');
    expect(within(today).getByText('15 phút trước')).toBeInTheDocument();

    const yesterday = within(box).getByRole('region', { name: 'Hôm qua' });
    expect(within(yesterday).getByText('Bạn')).toBeInTheDocument();
    expect(within(yesterday).getAllByRole('listitem')).toHaveLength(1);
    expect(within(yesterday).getByText(/\+1 thao tác khác trên thẻ này/)).toBeInTheDocument();
    expect(within(box).getByRole('region', { name: 'Thứ Bảy, 10/10' })).toBeInTheDocument();
    expect(mocks.fetchHomeActivity).toHaveBeenCalledWith('all');
  });

  it('chọn "Người khác": tải lại theo phạm vi, nhớ lựa chọn; trống thì có nút xem cả việc của mình', async () => {
    mocks.fetchHomeActivity.mockResolvedValueOnce(ROWS).mockResolvedValueOnce([]);
    const user = userEvent.setup();
    renderPage();
    const box = section();
    await within(box).findByRole('region', { name: 'Hôm nay' });
    await user.click(within(box).getByRole('button', { name: 'Người khác' }));
    expect(mocks.fetchHomeActivity).toHaveBeenLastCalledWith('others');
    expect(localStorage.getItem('tf.home.activityScope')).toBe('others');
    expect(await within(box).findByText('Chưa có ai khác hoạt động trên các bảng của bạn.')).toBeInTheDocument();

    mocks.fetchHomeActivity.mockResolvedValueOnce(ROWS);
    await user.click(within(box).getByRole('button', { name: 'Xem cả hoạt động của bạn' }));
    expect(mocks.fetchHomeActivity).toHaveBeenLastCalledWith('all');
    expect(await within(box).findByRole('region', { name: 'Hôm nay' })).toBeInTheDocument();
  });

  it('tải lỗi chỉ báo trong khối, các khối khác vẫn chạy', async () => {
    mocks.fetchHomeActivity.mockRejectedValue(new Error('500'));
    renderPage();
    expect(await within(section()).findByText('Không tải được hoạt động gần đây.')).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: 'Đánh dấu hoàn thành thẻ Chốt khách mời' })).toBeInTheDocument();
  });
});

describe('Tổng quan: khối Cần chú ý', () => {
  it('chia nhóm quá hạn / hôm nay / 7 ngày tới, ghi rõ hạn, bấm tên thẻ mở đúng thẻ', async () => {
    renderPage();
    const box = attention();
    const overdue = await within(box).findByRole('region', { name: 'Quá hạn' });
    expect(within(box).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Quá hạn',
      'Hôm nay',
      'Trong 7 ngày tới',
    ]);
    expect(within(overdue).getByRole('link', { name: 'Lấy báo giá âm thanh' })).toHaveAttribute(
      'href',
      '/boards/b1?card=c1'
    );
    expect(within(overdue).getAllByText('Quá hạn 4 ngày')).not.toHaveLength(0);
    expect(within(box).getAllByText('Còn 3 ngày')).not.toHaveLength(0);
    // Thẻ hạn xa hơn 7 ngày và thẻ đã xong từ trước không nằm trong khối
    expect(within(box).queryByText('Viết biên bản')).not.toBeInTheDocument();
    expect(within(box).queryByText('Đã xong từ trước')).not.toBeInTheDocument();
  });

  it('tick xong ngay trên trang: gọi API, thẻ ở lại gạch ngang để bỏ tick được, số quá hạn giảm', async () => {
    // Lần tải lại sau khi lưu: server trả thẻ đã xong (đã chuyển sang cột Hoàn thành)
    mocks.fetchMyCards
      .mockResolvedValueOnce(CARDS)
      .mockResolvedValue(CARDS.map((c) => (c.id === 'c1' ? { ...c, isDone: true, status: 'DONE' as const, completedAt: due(14, 11) } : c)));
    const user = userEvent.setup();
    renderPage();
    const tick = await screen.findByRole('checkbox', { name: 'Đánh dấu hoàn thành thẻ Lấy báo giá âm thanh' });
    await waitFor(() => expect(within(overdueStat()).getByText('1')).toBeInTheDocument());

    await user.click(tick);

    expect(mocks.updateCard).toHaveBeenCalledWith('c1', { isDone: true });
    // Tải lại danh sách sau khi lưu để cột / trạng thái mới đúng; thẻ vẫn ở lại khối (gạch ngang)
    await waitFor(() => expect(mocks.fetchMyCards).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('checkbox', { name: 'Mở lại thẻ Lấy báo giá âm thanh' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(within(attention()).getAllByText('Đã xong')).not.toHaveLength(0);
    await waitFor(() => expect(within(overdueStat()).getByText('0')).toBeInTheDocument());
    await waitFor(() => expect(within(stat('Xong tuần này')).getByText('2')).toBeInTheDocument());
  });

  it('lưu lỗi thì trả ô tick về như cũ và báo lỗi', async () => {
    mocks.updateCard.mockRejectedValue(new Error('mất mạng'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: 'Đánh dấu hoàn thành thẻ Chốt khách mời' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Không cập nhật được thẻ.');
    expect(screen.getByRole('checkbox', { name: 'Đánh dấu hoàn thành thẻ Chốt khách mời' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('mỗi nhóm hiện tối đa 5 thẻ, phần còn lại dẫn sang trang Công việc của tôi', async () => {
    mocks.fetchMyCards.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => card(`o${i}`, `Việc trễ ${i + 1}`, { dueDate: due(i + 1) }))
    );
    renderPage();
    const overdue = await within(attention()).findByRole('region', { name: 'Quá hạn' });
    expect(within(overdue).getAllByRole('checkbox')).toHaveLength(5);
    expect(within(overdue).getByRole('link', { name: '+2 thẻ nữa' })).toHaveAttribute('href', '/my-cards');
  });

  it('tải lỗi thì không báo nhầm là "không có thẻ nào sắp đến hạn"', async () => {
    mocks.fetchMyCards.mockRejectedValue(new Error('500'));
    renderPage();
    expect(await within(attention()).findByText('Không tải được danh sách thẻ.')).toBeInTheDocument();
    expect(screen.queryByText('Không có thẻ nào sắp đến hạn.')).not.toBeInTheDocument();
  });
});
