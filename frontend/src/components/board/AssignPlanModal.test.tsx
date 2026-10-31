import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignPlanPick, AssignPlanPerson, AssignPlanRanking, AssignPlanResult, AssignPlanRow } from '../../types/assign';
import AssignPlanModal from './AssignPlanModal';

// Màn hình chia việc: mock lớp gọi API (đã có test riêng) và kiểm HÀNH VI nhìn thấy được: thứ tự dòng, gợi ý được chọn sẵn, giá trị
// thô, cảnh báo, phân bố sau khi chia, sửa người / bỏ tick, giao TUẦN TỰ, xử lý thẻ lỗi và thông báo cho bảng khi có thẻ đã giao.

const mocks = vi.hoisted(() => ({ fetchAssignPlan: vi.fn(), addCardMember: vi.fn() }));
vi.mock('../../lib/api/assign', () => ({ fetchAssignPlan: mocks.fetchAssignPlan }));
vi.mock('../../lib/api/card', () => ({ addCardMember: mocks.addCardMember }));

const comp = (value: number | null) => ({ value, weight: 0.3, scaled: value, share: 0.3 });

const person = (id: string, name: string, over: Partial<AssignPlanPerson> = {}): AssignPlanPerson => ({
  user: { id, name, avatarUrl: null },
  capacity: 5,
  openCards: 1,
  paused: false,
  ...over,
});

const pick = (id: string, name: string, over: Partial<AssignPlanPick> = {}): AssignPlanPick => ({
  user: { id, name, avatarUrl: null },
  score: 82.4,
  rawScore: 61,
  confidence: 0.6,
  confidenceLevel: 'GOOD',
  components: { experience: comp(0.71), reliability: comp(1), availability: comp(0.4), declared: comp(0.33) },
  load: 1,
  capacity: 5,
  flags: [],
  ...over,
});

const rk = (userId: string, rank: number, over: Partial<AssignPlanRanking> = {}): AssignPlanRanking => ({
  userId,
  rank,
  score: 70,
  load: 1,
  capacity: 5,
  flags: [],
  ...over,
});

const DUE = '2026-09-25T09:00:00.000Z';

const R1: AssignPlanRow = {
  order: 1,
  card: { id: 'c1', title: 'Thiết kế màn hình đăng nhập', startDate: null, dueDate: DUE },
  assignee: pick('u1', 'Lan Nguyễn'),
  ranking: [rk('u1', 1, { score: 82.4 }), rk('u2', 2, { score: 40.2 })],
};
const R2: AssignPlanRow = {
  order: 2,
  card: { id: 'c2', title: 'Viết báo cáo tuần', startDate: null, dueDate: null },
  assignee: pick('u2', 'Bình Trần', { score: 75.1, load: 5, capacity: 5, flags: ['OVERLOADED'] }),
  ranking: [rk('u2', 1, { score: 75.1, load: 5, capacity: 5, flags: ['OVERLOADED'] }), rk('u1', 2, { score: 60, load: 2 })],
};
const R4: AssignPlanRow = {
  order: 4,
  card: { id: 'c4', title: 'Cập nhật tài liệu', startDate: null, dueDate: DUE },
  assignee: pick('u1', 'Lan Nguyễn', { score: 66.6 }),
  ranking: [rk('u1', 1, { score: 66.6, load: 2, flags: ['NO_SIMILAR'] }), rk('u2', 2, { score: 30, load: 2 })],
};
const R3: AssignPlanRow = {
  order: 3,
  card: { id: 'c3', title: 'Việc chưa ai nhận được', startDate: null, dueDate: DUE },
  assignee: null,
  ranking: [rk('u1', 1, { score: 50, flags: ['PAUSED'] }), rk('u2', 2, { score: 45, flags: ['PAUSED'] })],
};

function plan(rows: AssignPlanRow[], over: Partial<AssignPlanResult> = {}): AssignPlanResult {
  return {
    list: { id: 'l1', name: 'Việc tuần này', boardId: 'b1', workspaceId: 'w1' },
    algorithmVersion: 'knn-tfidf-v1/minmax/drop',
    planVersion: 'greedy-v1',
    generatedAt: '2026-09-20T05:00:00.000Z',
    weights: { experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2, custom: false },
    groupOnTimeRate: 0.6,
    people: [person('u1', 'Lan Nguyễn'), person('u2', 'Bình Trần')],
    totalUnassigned: rows.length,
    truncated: false,
    rows,
    ...over,
  };
}

function setup(result: AssignPlanResult | Promise<AssignPlanResult> = plan([R1, R2, R3])) {
  mocks.fetchAssignPlan.mockReturnValue(Promise.resolve(result));
  const onClose = vi.fn();
  const onApplied = vi.fn();
  const view = render(<AssignPlanModal listId="l1" listName="Việc tuần này" onClose={onClose} onApplied={onApplied} />);
  return { onClose, onApplied, ...view };
}

const flush = () => act(async () => {});
const rowOf = (cardId: string) => within(screen.getByTestId(`plan-row-${cardId}`));
const shareOf = (userId: string) => screen.getByTestId(`plan-share-${userId}`);
const applyButton = () => screen.getByRole('button', { name: /^Áp dụng cho|^Đang giao/ });
const closeButtons = () => screen.getAllByRole('button', { name: 'Đóng' });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.addCardMember.mockResolvedValue(undefined);
  document.body.style.overflow = '';
});

describe('AssignPlanModal - hiển thị kế hoạch', () => {
  it('đang tính -> khung chờ; xong -> tiêu đề có tên danh sách, các dòng THEO THỨ TỰ máy chủ kèm hạng, hạn và người được gợi ý chọn sẵn', async () => {
    let resolve!: (r: AssignPlanResult) => void;
    setup(new Promise((r) => (resolve = r)));
    expect(screen.getByRole('status')).toHaveTextContent('Đang tính kế hoạch');
    expect(screen.queryByTestId('plan-row-c1')).not.toBeInTheDocument();

    await act(async () => resolve(plan([R1, R2, R3])));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Chia việc gợi ý — Việc tuần này' })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^plan-row-/).map((el) => el.getAttribute('data-testid'))).toEqual(['plan-row-c1', 'plan-row-c2', 'plan-row-c3']);

    const r1 = rowOf('c1');
    expect(r1.getByText('1')).toBeInTheDocument();
    expect(r1.getByText('Thiết kế màn hình đăng nhập')).toBeInTheDocument();
    expect(r1.getByText('Hạn 25/09/2026')).toBeInTheDocument();
    expect(r1.getByRole('combobox', { name: 'Người nhận thẻ Thiết kế màn hình đăng nhập' })).toHaveValue('u1');
    expect(r1.getByRole('checkbox', { name: 'Chọn thẻ Thiết kế màn hình đăng nhập' })).toBeChecked();
    expect(rowOf('c2').getByText('Không có hạn')).toBeInTheDocument();
    expect(rowOf('c2').getByRole('combobox', { name: 'Người nhận thẻ Viết báo cáo tuần' })).toHaveValue('u2');
  });

  it('dòng của người được gợi ý có điểm tương đối, tải và bốn giá trị THÔ; nhãn của ô chọn có điểm và cờ', async () => {
    setup();
    await flush();
    const r1 = rowOf('c1');
    expect(r1.getByText('Phù hợp 82')).toBeInTheDocument();
    expect(r1.getByText('Tải 1/5')).toBeInTheDocument();
    expect(r1.getByText('KN 71%')).toBeInTheDocument();
    expect(r1.getByText('TC 100%')).toBeInTheDocument();
    expect(r1.getByText('KD 40%')).toBeInTheDocument();
    expect(r1.getByText('HS 33%')).toBeInTheDocument();
    const options = r1.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['— Không giao —', 'Lan Nguyễn — phù hợp 82', 'Bình Trần — phù hợp 40']);
    expect(rowOf('c2').getAllByRole('option').map((o) => o.textContent)).toContain('Bình Trần — phù hợp 75 · quá tải');
  });

  it('người quá tải: cảnh báo ngay trên dòng và huy hiệu; chân trang báo có thẻ giao cho người quá tải / tạm nghỉ', async () => {
    setup();
    await flush();
    const r2 = rowOf('c2');
    expect(r2.getByText('Bình Trần đang quá tải (5/5 thẻ chồng lấn).')).toBeInTheDocument();
    expect(r2.getByText('Quá tải (5/5 thẻ)')).toBeInTheDocument();
    expect(rowOf('c1').queryByText(/đang quá tải/)).not.toBeInTheDocument();
    expect(screen.getByText('1 thẻ giao cho người đang quá tải hoặc tạm nghỉ.')).toBeInTheDocument();
  });

  it('huy hiệu cờ: quá tải và tạm nghỉ màu CẢNH BÁO, cờ thường (chưa có thẻ giống...) màu thường', async () => {
    setup(plan([R2, R4]));
    await flush();
    const warn = rowOf('c2').getByText('Quá tải (5/5 thẻ)');
    expect(warn).toHaveClass('bg-amber-100');
    const plain = rowOf('c4').getByText('Chưa làm việc tương tự');
    expect(plain).toHaveClass('bg-slate-100');
    expect(plain).not.toHaveClass('bg-amber-100');
    // Người tạm nghỉ được chọn tay cũng màu cảnh báo
    fireEvent.change(rowOf('c4').getByRole('combobox', { name: /Người nhận thẻ/ }), { target: { value: 'u2' } });
    expect(rowOf('c4').queryByText('Chưa làm việc tương tự')).not.toBeInTheDocument();
  });

  it('thẻ không ai đủ điều kiện: không tick được, để trống, có giải thích; không được đếm vào số thẻ sẽ giao', async () => {
    setup();
    await flush();
    const r3 = rowOf('c3');
    expect(r3.getByRole('checkbox', { name: 'Chọn thẻ Việc chưa ai nhận được' })).toBeDisabled();
    expect(r3.getByRole('checkbox', { name: 'Chọn thẻ Việc chưa ai nhận được' })).not.toBeChecked();
    expect(r3.getByRole('combobox', { name: 'Người nhận thẻ Việc chưa ai nhận được' })).toHaveValue('');
    expect(r3.getByText(/Không có ai phù hợp lúc này/)).toBeInTheDocument();
    expect(applyButton()).toHaveTextContent('Áp dụng cho 2 thẻ');
  });

  it('phân bố sau khi áp dụng: thẻ mới, tổng thẻ đang mở / sức chứa, cờ tạm nghỉ và vượt sức chứa', async () => {
    setup(
      plan([R1, R2], {
        people: [person('u1', 'Lan Nguyễn', { capacity: 2, openCards: 2 }), person('u2', 'Bình Trần', { capacity: 5, openCards: 1, paused: true })],
      })
    );
    await flush();
    expect(within(shareOf('u1')).getByText('+1 thẻ mới · đang mở 3/2')).toBeInTheDocument();
    expect(within(shareOf('u1')).getByText('Vượt sức chứa')).toBeInTheDocument();
    expect(within(shareOf('u1')).queryByText('Đang tạm nghỉ')).not.toBeInTheDocument();
    expect(within(shareOf('u2')).getByText('+1 thẻ mới · đang mở 2/5')).toBeInTheDocument();
    expect(within(shareOf('u2')).getByText('Đang tạm nghỉ')).toBeInTheDocument();
    expect(within(shareOf('u2')).queryByText('Vượt sức chứa')).not.toBeInTheDocument();
  });

  it('cắt bớt: báo còn bao nhiêu thẻ chưa chia; danh sách trống: nói rõ và không có nút Áp dụng', async () => {
    const { unmount } = setup(plan([R1], { truncated: true, totalUnassigned: 45 }));
    await flush();
    expect(screen.getByRole('note')).toHaveTextContent('Danh sách có 45 thẻ chưa giao; lượt này chỉ chia 1 thẻ gấp nhất.');
    unmount();

    setup(plan([]));
    await flush();
    expect(screen.getByText('Danh sách này không có thẻ nào chưa giao người.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Áp dụng/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('lỗi tải: báo lỗi máy chủ nếu có, không thì thông điệp chung; "Thử lại" gọi lại và hiện kế hoạch', async () => {
    mocks.fetchAssignPlan.mockRejectedValueOnce(
      new AxiosError('x', 'ERR', undefined, undefined, { status: 429, data: { message: 'Bạn thao tác quá nhiều lần.' } } as never)
    );
    mocks.fetchAssignPlan.mockResolvedValueOnce(plan([R1]));
    render(<AssignPlanModal listId="l1" listName="Việc tuần này" onClose={vi.fn()} onApplied={vi.fn()} />);
    await flush();
    expect(screen.getByText('Bạn thao tác quá nhiều lần.')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-row-c1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    await flush();
    expect(mocks.fetchAssignPlan).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('plan-row-c1')).toBeInTheDocument();
  });

  it('lỗi không rõ nguyên nhân -> thông điệp chung', async () => {
    mocks.fetchAssignPlan.mockRejectedValue(new Error('mạng đứt'));
    render(<AssignPlanModal listId="l1" listName="Việc tuần này" onClose={vi.fn()} onApplied={vi.fn()} />);
    await flush();
    expect(screen.getByText('Chưa tính được kế hoạch lúc này.')).toBeInTheDocument();
  });

  it('đổi sang danh sách khác khi kết quả của danh sách cũ chưa về: kết quả cũ về muộn KHÔNG được đè lên', async () => {
    let resolveOld!: (r: AssignPlanResult) => void;
    mocks.fetchAssignPlan.mockImplementation((id: string) =>
      id === 'l1' ? new Promise<AssignPlanResult>((r) => (resolveOld = r)) : Promise.resolve(plan([R2], { list: { id: 'l2', name: 'Danh sách hai', boardId: 'b1', workspaceId: 'w1' } }))
    );
    const view = render(<AssignPlanModal listId="l1" listName="Danh sách một" onClose={vi.fn()} onApplied={vi.fn()} />);
    view.rerender(<AssignPlanModal listId="l2" listName="Danh sách hai" onClose={vi.fn()} onApplied={vi.fn()} />);
    await flush();
    expect(screen.getByTestId('plan-row-c2')).toBeInTheDocument();
    await act(async () => resolveOld(plan([R1])));
    expect(screen.queryByTestId('plan-row-c1')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-row-c2')).toBeInTheDocument();
  });

  it('React.StrictMode (mount hai lần) chỉ gọi máy chủ MỘT lần (máy chủ giới hạn 10 lượt / 10 phút)', async () => {
    mocks.fetchAssignPlan.mockResolvedValue(plan([R1]));
    render(
      <StrictMode>
        <AssignPlanModal listId="l1" listName="Việc tuần này" onClose={vi.fn()} onApplied={vi.fn()} />
      </StrictMode>
    );
    await flush();
    expect(mocks.fetchAssignPlan).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('plan-row-c1')).toBeInTheDocument();
  });
});

describe('AssignPlanModal - sửa kế hoạch', () => {
  it('đổi người: phân bố, chi tiết và số thẻ cập nhật ngay; chi tiết của người KHÔNG được gợi ý không có KN/TC/KD (máy chủ không gửi)', async () => {
    setup(plan([R1, R2]));
    await flush();
    const select = rowOf('c1').getByRole('combobox', { name: 'Người nhận thẻ Thiết kế màn hình đăng nhập' });
    fireEvent.change(select, { target: { value: 'u2' } });
    expect(select).toHaveValue('u2');
    expect(within(shareOf('u1')).getByText('+0 thẻ mới · đang mở 1/5')).toBeInTheDocument();
    expect(within(shareOf('u2')).getByText('+2 thẻ mới · đang mở 3/5')).toBeInTheDocument();
    expect(rowOf('c1').getByText('Phù hợp 40')).toBeInTheDocument();
    expect(rowOf('c1').queryByText(/^KN /)).not.toBeInTheDocument();
    expect(rowOf('c1').queryByText(/^HS /)).not.toBeInTheDocument();
    expect(rowOf('c1').getByRole('checkbox', { name: /Chọn thẻ/ })).toBeChecked();
    // Đổi lại đúng người được gợi ý thì KN/TC/KD hiện lại
    fireEvent.change(select, { target: { value: 'u1' } });
    expect(rowOf('c1').getByText('KN 71%')).toBeInTheDocument();
  });

  it('chọn "Không giao" -> bỏ tick, thẻ không được giao; chọn lại một người -> tick lại', async () => {
    setup(plan([R1, R2]));
    await flush();
    const select = rowOf('c1').getByRole('combobox', { name: 'Người nhận thẻ Thiết kế màn hình đăng nhập' });
    fireEvent.change(select, { target: { value: '' } });
    expect(rowOf('c1').getByRole('checkbox', { name: /Chọn thẻ/ })).not.toBeChecked();
    expect(rowOf('c1').getByRole('checkbox', { name: /Chọn thẻ/ })).toBeDisabled();
    expect(rowOf('c1').getByText('Không giao thẻ này.')).toBeInTheDocument();
    expect(applyButton()).toHaveTextContent('Áp dụng cho 1 thẻ');
    fireEvent.change(select, { target: { value: 'u2' } });
    expect(rowOf('c1').getByRole('checkbox', { name: /Chọn thẻ/ })).toBeChecked();
    expect(applyButton()).toHaveTextContent('Áp dụng cho 2 thẻ');
  });

  it('bỏ tick một thẻ: không tính vào số thẻ và phân bố; tick lại thì tính lại; hết thẻ -> nút Áp dụng bị khoá', async () => {
    setup(plan([R1, R2]));
    await flush();
    fireEvent.click(rowOf('c2').getByRole('checkbox', { name: /Chọn thẻ/ }));
    expect(applyButton()).toHaveTextContent('Áp dụng cho 1 thẻ');
    expect(within(shareOf('u2')).getByText('+0 thẻ mới · đang mở 1/5')).toBeInTheDocument();
    expect(screen.getByText('Sẽ giao 1 thẻ.')).toBeInTheDocument(); // thẻ quá tải đã bỏ nên hết cảnh báo
    fireEvent.click(rowOf('c1').getByRole('checkbox', { name: /Chọn thẻ/ }));
    expect(applyButton()).toHaveTextContent('Áp dụng cho 0 thẻ');
    expect(applyButton()).toBeDisabled();
    fireEvent.click(rowOf('c2').getByRole('checkbox', { name: /Chọn thẻ/ }));
    expect(applyButton()).toHaveTextContent('Áp dụng cho 1 thẻ');
    expect(applyButton()).toBeEnabled();
  });
});

describe('AssignPlanModal - áp dụng', () => {
  it('giao đúng các thẻ đã tick cho đúng người, THEO THỨ TỰ, chỉ MỘT yêu cầu tại một thời điểm; xong thì báo bảng tải lại và đóng', async () => {
    const order: string[] = [];
    let inFlight = 0;
    let max = 0;
    mocks.addCardMember.mockImplementation(async (cardId: string, userId: string) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await Promise.resolve();
      order.push(`${cardId}:${userId}`);
      inFlight -= 1;
    });
    const { onClose, onApplied } = setup();
    await flush();
    fireEvent.change(rowOf('c1').getByRole('combobox', { name: /Người nhận thẻ/ }), { target: { value: 'u2' } });
    fireEvent.click(applyButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['c1:u2', 'c2:u2']); // c3 (không ai đủ điều kiện) không được giao
    expect(max).toBe(1);
    expect(mocks.addCardMember).toHaveBeenCalledTimes(2);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('đang giao: nút đổi chữ và khoá, ô chọn và nút Đóng bị khoá, Escape và bấm nền KHÔNG đóng', async () => {
    let finish!: () => void;
    mocks.addCardMember.mockReturnValue(new Promise<void>((r) => (finish = r)));
    const { onClose } = setup(plan([R1]));
    await flush();
    fireEvent.click(applyButton());
    await flush();
    expect(applyButton()).toHaveTextContent('Đang giao…');
    expect(applyButton()).toBeDisabled();
    expect(rowOf('c1').getByRole('combobox', { name: /Người nhận thẻ/ })).toBeDisabled();
    expect(rowOf('c1').getByRole('checkbox', { name: /Chọn thẻ/ })).toBeDisabled();
    expect(closeButtons()).toHaveLength(2); // dấu X ở đầu và nút Đóng ở chân
    for (const b of closeButtons()) expect(b).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(document.querySelector('.fixed.inset-0')!);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('một thẻ lỗi: giữ màn hình mở, thẻ đã giao đánh dấu "Đã giao" và khoá (hết cảnh báo), thẻ lỗi hiện lý do; áp dụng lại chỉ giao thẻ còn lại và xoá lỗi cũ', async () => {
    mocks.addCardMember.mockImplementation(async (cardId: string) => {
      if (cardId === 'c1') throw new AxiosError('x', 'ERR', undefined, undefined, { status: 400, data: { message: 'Chỉ gán được thành viên của bảng vào thẻ' } } as never);
    });
    const { onClose, onApplied } = setup(plan([R1, R2, R4]));
    await flush();
    fireEvent.click(applyButton());
    await flush();
    await flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    // c2 và c4 giao được (SAU thẻ lỗi c1: một thẻ lỗi không chặn thẻ sau), c1 lỗi
    for (const id of ['c2', 'c4']) {
      expect(rowOf(id).getByText('Đã giao')).toBeInTheDocument();
      expect(rowOf(id).getByRole('checkbox', { name: /Chọn thẻ/ })).toBeChecked();
      expect(rowOf(id).getByRole('checkbox', { name: /Chọn thẻ/ })).toBeDisabled();
      expect(rowOf(id).getByRole('combobox', { name: /Người nhận thẻ/ })).toBeDisabled();
    }
    expect(rowOf('c2').queryByText(/đang quá tải/)).not.toBeInTheDocument(); // thẻ đã giao xong thì hết cảnh báo
    // Bảng phân bố vẫn tính CẢ thẻ đã giao xong (chúng là việc của người đó rồi): u1 nhận c1 (lỗi, còn chờ) và c4; u2 nhận c2
    expect(within(shareOf('u1')).getByText('+2 thẻ mới · đang mở 3/5')).toBeInTheDocument();
    expect(within(shareOf('u2')).getByText('+1 thẻ mới · đang mở 2/5')).toBeInTheDocument();
    expect(rowOf('c1').queryByText('Đã giao')).not.toBeInTheDocument();
    expect(rowOf('c1').getByRole('alert')).toHaveTextContent('Không giao được: Chỉ gán được thành viên của bảng vào thẻ');
    expect(screen.getByText('1 thẻ chưa giao được — sửa rồi bấm áp dụng lại.')).toBeInTheDocument();
    expect(applyButton()).toHaveTextContent('Áp dụng cho 1 thẻ');

    let finish!: () => void;
    mocks.addCardMember.mockClear();
    mocks.addCardMember.mockReturnValue(new Promise<void>((r) => (finish = r)));
    fireEvent.click(applyButton());
    await flush();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // lỗi cũ biến mất khi bắt đầu lượt mới
    expect(applyButton()).toHaveTextContent('Đang giao…');
    await act(async () => finish());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.addCardMember).toHaveBeenCalledTimes(1);
    expect(mocks.addCardMember).toHaveBeenCalledWith('c1', 'u1');
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('có thẻ đã giao rồi mới đóng (còn thẻ lỗi) -> báo bảng tải lại đúng MỘT lần; chưa giao gì mà đóng -> không báo', async () => {
    mocks.addCardMember.mockImplementation(async (cardId: string) => {
      if (cardId === 'c2') throw new Error('hỏng');
    });
    const first = setup(plan([R1, R2]));
    await flush();
    fireEvent.click(applyButton());
    await flush();
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Không giao được: Không giao được thẻ này.'); // lỗi không rõ -> thông điệp chung
    fireEvent.click(closeButtons()[1]!);
    expect(first.onApplied).toHaveBeenCalledTimes(1);
    expect(first.onClose).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = setup(plan([R1]));
    await flush();
    fireEvent.click(closeButtons()[0]!);
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect(second.onApplied).not.toHaveBeenCalled();
  });
});

describe('AssignPlanModal - đóng và khoá cuộn', () => {
  it('Escape và bấm nền đóng; bấm trong hộp thoại thì không', async () => {
    const { onClose } = setup(plan([R1]));
    await flush();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('.fixed.inset-0')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('khoá cuộn trang nền khi mở và trả lại đúng giá trị cũ khi đóng', async () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = setup(plan([R1]));
    await flush();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });
});
