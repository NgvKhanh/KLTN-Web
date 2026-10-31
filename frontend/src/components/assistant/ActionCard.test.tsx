import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantTurn } from '../../context/AssistantContext';
import type { ChatActionPlan, ChatActionResult, ChatActionView, ChatReply, ChatScope } from '../../types/chat';
import ActionCard from './ActionCard';

// Khoi thao tac (Phase 1) o muc thanh phan: moi trang thai cua ban xem truoc va ket qua, khong qua AssistantContext.

const plan = (over: Partial<ChatActionPlan> = {}): ChatActionPlan => ({
  planId: 'p1', checksum: 'c'.repeat(64), status: 'PROPOSED', risk: 'MEDIUM', requiresConfirmation: true, canConfirm: true,
  reasons: [{ code: 'FUZZY_DATE', text: 'Ngày hạn bạn nói còn mơ hồ (ví dụ “cuối tuần”). Hãy kiểm tra ngày mình đã hiểu.' }],
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), boardId: 'b1', boardName: 'Dự án Alpha',
  items: [{ index: 0, verb: 'Đặt hạn', text: '“Thiết kế giao diện”', detail: 'Chủ nhật, 11/10/2026', cardId: 'c1' }], warnings: ['Ngày hạn được lấy theo đúng câu của bạn (khác với ngày AI đề xuất).'], ...over,
});
const result = (over: Partial<ChatActionResult> = {}): ChatActionResult => ({
  planId: 'p1', status: 'EXECUTED', autoExecuted: false, summary: 'Đã đặt hạn cho thẻ “Thiết kế giao diện”: Chủ nhật, 11/10/2026.', boardId: 'b1', cardId: 'c1', warnings: [], ...over,
});
function turnOf(action: ChatActionView | undefined, over: Partial<AssistantTurn> = {}): AssistantTurn {
  const reply = { conversationId: 'conv', understood: {}, answer: { kind: 'ANSWER', text: '', action } } as unknown as ChatReply;
  return { id: 1, question: 'q', status: 'done', reply, cards: [], page: 1, error: null, loadingMore: false, moreError: null, actionBusy: false, actionError: null, ...over };
}
function renderCard(turn: AssistantTurn, scope: ChatScope = { kind: 'MY' }, busy = false) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<MemoryRouter><ActionCard turn={turn} scope={scope} busy={busy} onConfirm={onConfirm} onCancel={onCancel} /></MemoryRouter>);
  return { onConfirm, onCancel };
}

describe('ActionCard: ban xem truoc', () => {
  it('hien ten bang, thao tac, ly do can xem lai, canh bao va gio het han; Ap dung / Huy goi dung ham voi dung luot', () => {
    const turn = turnOf({ kind: 'PLAN', plan: plan() });
    const { onConfirm, onCancel } = renderCard(turn);
    const block = screen.getByRole('region', { name: 'Kế hoạch thao tác' });
    expect(within(block).getByRole('link', { name: 'Dự án Alpha' })).toHaveAttribute('href', '/boards/b1');
    expect(within(block).getByText('Đặt hạn')).toBeInTheDocument();
    expect(within(block).getByText('Chủ nhật, 11/10/2026')).toBeInTheDocument();
    expect(within(block).getByRole('note')).toHaveTextContent('Cần bạn xem lại trước khi áp dụng');
    expect(within(block).getByRole('note')).toHaveTextContent('Ngày hạn bạn nói còn mơ hồ');
    expect(within(block).getByText('Ngày hạn được lấy theo đúng câu của bạn (khác với ngày AI đề xuất).')).toBeInTheDocument();
    fireEvent.click(within(block).getByRole('button', { name: 'Áp dụng' }));
    expect(onConfirm).toHaveBeenCalledWith(turn);
    fireEvent.click(within(block).getByRole('button', { name: 'Hủy' }));
    expect(onCancel).toHaveBeenCalledWith(turn);
  });

  it('khong co ly do thi khong ve khung "can xem lai"', () => {
    renderCard(turnOf({ kind: 'PLAN', plan: plan({ reasons: [], warnings: [] }) }));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('dang chay (EXECUTING) hoac cho chon: khong co nut, noi ro dang thuc hien', () => {
    renderCard(turnOf({ kind: 'PLAN', plan: plan({ status: 'EXECUTING', canConfirm: false }) }));
    expect(screen.getByText('Kế hoạch đang được thực hiện…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('dang gui Ap dung (busy): ca hai nut khoa; hien loi neu lan truoc that bai', () => {
    renderCard(turnOf({ kind: 'PLAN', plan: plan() }, { actionBusy: true, actionError: 'Kế hoạch đã thay đổi hoặc đang được xử lý.' }), { kind: 'MY' }, true);
    expect(screen.getByRole('button', { name: 'Đang áp dụng…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Kế hoạch đã thay đổi hoặc đang được xử lý.');
  });

  it('o trang bang trung khop thi dung duoc; khac bang thi khoa va giai thich; trang chu khong han che', () => {
    const view = turnOf({ kind: 'PLAN', plan: plan() });
    const same = renderCard(view, { kind: 'BOARD', boardId: 'b1' });
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(same.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('khac bang: khoa nut va noi ro chua thay doi gi', () => {
    const { onConfirm } = renderCard(turnOf({ kind: 'PLAN', plan: plan() }), { kind: 'BOARD', boardId: 'b2' });
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeDisabled();
    expect(screen.getByText(/thuộc bảng khác với bảng đang mở nên không áp dụng được ở đây\. Chưa thay đổi gì\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('het han: khoa Ap dung va Huy, noi ro chua thay doi gi', () => {
    renderCard(turnOf({ kind: 'PLAN', plan: plan({ canConfirm: false, expiresAt: new Date(Date.now() - 1000).toISOString() }) }));
    expect(screen.getByText('Kế hoạch đã hết hạn. Hãy gửi lại lệnh. Chưa thay đổi gì.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeDisabled();
  });
});

describe('ActionCard: ket qua', () => {
  it.each([
    ['EXECUTED', 'Đã thực hiện'],
    ['FAILED', 'Chưa thực hiện được'],
    ['STALE', 'Dữ liệu đã thay đổi'],
    ['CANCELLED', 'Đã hủy'],
    ['EXPIRED', 'Đã hết hạn'],
  ] as const)('trang thai %s co nhan "%s"', (status, label) => {
    renderCard(turnOf({ kind: 'RESULT', result: result({ status }) }));
    const block = screen.getByRole('region', { name: 'Kết quả thao tác' });
    expect(within(block).getByText(label)).toBeInTheDocument();
    expect(within(block).queryByRole('button')).not.toBeInTheDocument();
    // chi thao tac DA CHAY moi co lien ket mo the
    if (status === 'EXECUTED') expect(within(block).getByRole('link', { name: 'Mở thẻ' })).toHaveAttribute('href', '/boards/b1?card=c1');
    else expect(within(block).queryByRole('link', { name: 'Mở thẻ' })).not.toBeInTheDocument();
  });

  it('tu chay: ghi "theo lenh cua ban"; ap dung lai: ghi da ap dung truoc do; canh bao hien day du', () => {
    renderCard(turnOf({ kind: 'RESULT', result: result({ autoExecuted: true, alreadyApplied: true, warnings: ['Thông báo chưa gửi được.'] }) }));
    expect(screen.getByText('Đã thực hiện · theo lệnh của bạn')).toBeInTheDocument();
    expect(screen.getByText('Kế hoạch này đã được áp dụng trước đó, không ghi thêm lần nữa.')).toBeInTheDocument();
    expect(screen.getByText('Thông báo chưa gửi được.')).toBeInTheDocument();
  });

  it('vung bao ngoai la aria-live="polite" de doc ket qua khi the xem truoc doi thanh ket qua', () => {
    const { container } = render(
      <MemoryRouter>
        <ActionCard turn={turnOf({ kind: 'RESULT', result: result() })} scope={{ kind: 'MY' }} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>
    );
    expect(container.firstElementChild).toHaveAttribute('aria-live', 'polite');
  });

  it('khong co hanh dong thi khong ve gi', () => {
    const { container } = render(
      <MemoryRouter>
        <ActionCard turn={turnOf(undefined)} scope={{ kind: 'MY' }} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// ---------- Phase 2: ke hoach NHIEU thao tac ----------
const multiPlan = (over: Partial<ChatActionPlan> = {}): ChatActionPlan =>
  plan({
    risk: 'MEDIUM',
    opCount: 4,
    reasons: [
      { code: 'MULTI_OP', text: 'Lệnh gồm nhiều thay đổi cùng lúc nên mình luôn cho bạn xem lại trước khi áp dụng.' },
      { code: 'NEW_STRUCTURE', text: 'Tạo cột làm thay đổi cấu trúc của bảng nên cần bạn xác nhận.' },
    ],
    warnings: [],
    items: [
      { index: 0, verb: 'Tạo cột', text: '“Kiểm thử”', detail: 'Trạng thái cột: Chờ duyệt' },
      { index: 1, verb: 'Tạo thẻ', text: '“Unit Test”', detail: 'Trong cột mới “Kiểm thử”' },
      { index: 2, verb: 'Tạo thẻ', text: '“API Test”', detail: 'Trong cột mới “Kiểm thử”' },
      { index: 3, verb: 'Giao thẻ', text: '“API Test” (thẻ mới) cho Nguyễn Lan', cardId: 'c9' },
    ],
    ...over,
  });

describe('ActionCard: ban xem truoc NHIEU thao tac', () => {
  it('hien so thay doi, danh sach danh so theo thu tu chay, ly do va nut ghi ro so thay doi; Ap dung / Huy van goi dung', () => {
    const turn = turnOf({ kind: 'PLAN', plan: multiPlan() });
    const { onConfirm, onCancel } = renderCard(turn);
    const block = screen.getByRole('region', { name: 'Kế hoạch thao tác' });
    expect(within(block).getByRole('heading')).toHaveTextContent('4 thay đổi trên bảng Dự án Alpha');
    const steps = within(block.querySelector('ol') as HTMLElement).getAllByRole('listitem'); // danh sách bước (khác danh sách lý do trong khung ghi chú)
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.textContent)).toEqual([
      'Tạo cột “Kiểm thử”Trạng thái cột: Chờ duyệt',
      'Tạo thẻ “Unit Test”Trong cột mới “Kiểm thử”',
      'Tạo thẻ “API Test”Trong cột mới “Kiểm thử”',
      'Giao thẻ “API Test” (thẻ mới) cho Nguyễn LanMở thẻ',
    ]);
    expect(within(block).getByText(/làm tất cả hoặc không làm gì/)).toBeInTheDocument();
    expect(within(block).getByRole('note')).toHaveTextContent('Lệnh gồm nhiều thay đổi cùng lúc');
    expect(within(block).getByRole('note')).toHaveTextContent('Tạo cột làm thay đổi cấu trúc');
    fireEvent.click(within(block).getByRole('button', { name: 'Áp dụng 4 thay đổi' }));
    expect(onConfirm).toHaveBeenCalledWith(turn);
    fireEvent.click(within(block).getByRole('button', { name: 'Hủy' }));
    expect(onCancel).toHaveBeenCalledWith(turn);
  });

  it('đúng hai thao tác đã là kế hoạch nhiều thao tác (danh sách đánh số, nút ghi "2 thay đổi")', () => {
    const two = multiPlan({ opCount: 2, items: multiPlan().items.slice(0, 2), reasons: [{ code: 'MULTI_OP', text: 'Lệnh gồm nhiều thay đổi cùng lúc nên mình luôn cho bạn xem lại trước khi áp dụng.' }] });
    renderCard(turnOf({ kind: 'PLAN', plan: two }));
    expect(screen.getByRole('heading')).toHaveTextContent('2 thay đổi trên bảng Dự án Alpha');
    expect(screen.getByRole('button', { name: 'Áp dụng 2 thay đổi' })).toBeInTheDocument();
  });

  it('máy chủ cũ không gửi opCount: dùng số dòng; một thao tác giữ giao diện cũ (ul, nút "Áp dụng")', () => {
    const { container } = render(
      <MemoryRouter>
        <ActionCard turn={turnOf({ kind: 'PLAN', plan: plan() })} scope={{ kind: 'MY' }} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />
      </MemoryRouter>
    );
    expect(container.querySelector('ol')).toBeNull();
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('Thao tác trên bảng Dự án Alpha');
  });

  it('đang áp dụng: khóa cả hai nút; hết hạn: khóa và nói rõ chưa thay đổi gì; khác bảng: khóa', () => {
    renderCard(turnOf({ kind: 'PLAN', plan: multiPlan() }, { actionBusy: true }), { kind: 'MY' }, true);
    expect(screen.getByRole('button', { name: 'Đang áp dụng…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeDisabled();
  });

  it('hết hạn hoặc sai bảng thì không bấm được Áp dụng', () => {
    const { onConfirm } = renderCard(turnOf({ kind: 'PLAN', plan: multiPlan({ canConfirm: false, expiresAt: new Date(Date.now() - 1000).toISOString() }) }));
    expect(screen.getByText('Kế hoạch đã hết hạn. Hãy gửi lại lệnh. Chưa thay đổi gì.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Áp dụng 4 thay đổi' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng 4 thay đổi' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('ActionCard: ket qua NHIEU thao tac', () => {
  const lines = ['Đã tạo cột “Kiểm thử”.', 'Đã tạo thẻ “Unit Test” trong cột “Kiểm thử”.', 'Đã tạo thẻ “API Test” trong cột “Kiểm thử”.'];

  it('đã áp dụng: tóm tắt + từng bước đã làm theo thứ tự', () => {
    renderCard(turnOf({ kind: 'RESULT', result: result({ summary: 'Đã áp dụng 3 thay đổi trên bảng “Dự án Alpha”.', opCount: 3, details: lines, cardIds: ['c1', 'c2'] }) }));
    const block = screen.getByRole('region', { name: 'Kết quả thao tác' });
    expect(within(block).getByText('Đã áp dụng 3 thay đổi trên bảng “Dự án Alpha”.')).toBeInTheDocument();
    expect(within(block).getAllByRole('listitem').map((l) => l.textContent)).toEqual(lines);
  });

  it('kế hoạch cũ (STALE) và lỗi (FAILED): hiện đúng nhãn, câu giải thích của máy chủ, không liệt kê bước nào đã làm', () => {
    renderCard(turnOf({ kind: 'RESULT', result: result({ status: 'STALE', summary: 'Thẻ đã được chuyển sang cột khác kể từ lúc xem trước. Dữ liệu đã thay đổi nên chưa thay đổi gì.', cardId: undefined, opCount: 3 }) }));
    const block = screen.getByRole('region', { name: 'Kết quả thao tác' });
    expect(within(block).getByText('Dữ liệu đã thay đổi')).toBeInTheDocument();
    expect(within(block).getByText(/chuyển sang cột khác kể từ lúc xem trước/)).toBeInTheDocument();
    expect(within(block).queryByRole('listitem')).not.toBeInTheDocument();
    expect(within(block).queryByRole('link', { name: 'Mở thẻ' })).not.toBeInTheDocument();
  });

  it('đã áp dụng trước đó (bấm đúp): báo không ghi thêm', () => {
    renderCard(turnOf({ kind: 'RESULT', result: result({ alreadyApplied: true, summary: 'Đã áp dụng 3 thay đổi trên bảng “Dự án Alpha”.', details: lines, opCount: 3 }) }));
    expect(screen.getByText('Kế hoạch này đã được áp dụng trước đó, không ghi thêm lần nữa.')).toBeInTheDocument();
  });
});

// ===================== Phase 3: Board Patch (AI mo rong bang) =====================

const patchPlan = (over: Partial<ChatActionPlan> = {}): ChatActionPlan =>
  plan({
    risk: 'MEDIUM',
    reasons: [{ code: 'BOARD_PATCH', text: 'Nội dung cột và thẻ này do AI đề xuất (không phải chữ bạn gõ) nên mình luôn cho bạn xem trước và chỉ thêm mới, không đụng tới dữ liệu cũ.' }],
    opCount: 3,
    items: [
      { index: 0, verb: 'Tạo cột', text: '“Kiểm thử”' },
      { index: 1, verb: 'Tạo thẻ', text: '“Viết kịch bản kiểm thử”', detail: 'Trong cột mới “Kiểm thử”' },
      { index: 2, verb: 'Tạo thẻ', text: '“Chuẩn bị dữ liệu”', detail: 'Trong cột “Cần làm”' },
    ],
    warnings: [],
    patch: {
      newLists: 1,
      newCards: 2,
      skipped: [
        { kind: 'CARD', title: 'thiet ke giao dien', reason: 'EXISTS', existing: 'Thiết kế giao diện', where: 'Cần làm' },
        { kind: 'CARD', title: 'Thanh toán API', reason: 'SIMILAR', existing: 'API thanh toán', where: 'Cần làm' },
        { kind: 'LIST', title: 'cot can lam', reason: 'EXISTS', existing: 'Cần làm' },
        { kind: 'CARD', title: 'Viết test', reason: 'DUPLICATE_IN_PATCH', existing: 'Viết test' },
        { kind: 'CARD', title: 'Việc lạc cột', reason: 'UNKNOWN_LIST' },
      ],
      untouched: { lists: 3, cards: 5 },
      context: { cardsShown: 5, cardsTotal: 5, truncated: false },
    },
    ...over,
  });

describe('ActionCard: Board Patch (AI mo rong bang)', () => {
  it('ban xem truoc: tieu de "Them vao bang", noi ro noi dung do AI de xuat, so cot / the moi, "Khong dung toi" du lieu cu va ly do BOARD_PATCH', () => {
    const turn = turnOf({ kind: 'PLAN', plan: patchPlan() });
    const { onConfirm, onCancel } = renderCard(turn);
    const block = screen.getByRole('region', { name: 'Kế hoạch thao tác' });
    expect(within(block).getByRole('heading')).toHaveTextContent('Thêm vào bảng Dự án Alpha');
    expect(within(block).getByText('Nội dung do AI đề xuất')).toBeInTheDocument();
    expect(block).toHaveTextContent('1 cột mới · 2 thẻ mới');
    expect(block).toHaveTextContent('Chỉ thêm mới, không sửa hay xóa dữ liệu hiện có.');
    expect(block).toHaveTextContent('Không đụng tới: 5 thẻ và 3 cột hiện có.');
    expect(within(block).getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      expect.arrayContaining(['Tạo cột “Kiểm thử”', 'Tạo thẻ “Viết kịch bản kiểm thử”Trong cột mới “Kiểm thử”']) as unknown as string[]
    );
    expect(within(block).getByRole('note')).toHaveTextContent('do AI đề xuất');
    fireEvent.click(within(block).getByRole('button', { name: 'Áp dụng 3 thay đổi' }));
    expect(onConfirm).toHaveBeenCalledWith(turn);
    fireEvent.click(within(block).getByRole('button', { name: 'Hủy' }));
    expect(onCancel).toHaveBeenCalledWith(turn);
  });

  it('muc "Da co - bo qua": dem va giai thich tung ly do (da co, gan giong, trung trong de xuat, khong chon duoc cot)', () => {
    renderCard(turnOf({ kind: 'PLAN', plan: patchPlan() }));
    const summary = screen.getByText('Đã có — bỏ qua (5)');
    const details = summary.closest('details') as HTMLElement;
    expect(details).not.toHaveAttribute('open'); // gap lai de khong chiem cho
    const text = details.textContent ?? '';
    expect(text).toContain('Thẻ “thiet ke giao dien” đã có — thẻ “Thiết kế giao diện” (cột “Cần làm”)');
    expect(text).toContain('Thẻ “Thanh toán API” gần giống thẻ “API thanh toán” (cột “Cần làm”)');
    expect(text).toContain('Cột “cot can lam” đã có (“Cần làm”), dùng cột này');
    expect(text).toContain('Thẻ “Viết test” trùng một mục khác trong đề xuất');
    expect(text).toContain('Thẻ “Việc lạc cột” bị bỏ vì không chọn được cột phù hợp');
  });

  it('khong co muc nao bi bo qua thi khong ve muc "Da co - bo qua"; chi 1 thao tac van la Board Patch (nut "Ap dung")', () => {
    renderCard(turnOf({ kind: 'PLAN', plan: patchPlan({ opCount: 1, items: [{ index: 0, verb: 'Tạo thẻ', text: '“Kiểm thử đăng nhập”', detail: 'Trong cột “Cần làm”' }], patch: { newLists: 0, newCards: 1, skipped: [], untouched: { lists: 3, cards: 5 }, context: { cardsShown: 5, cardsTotal: 5, truncated: false } } }) }));
    expect(screen.queryByText(/Đã có — bỏ qua/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeEnabled();
    expect(screen.getByRole('region', { name: 'Kế hoạch thao tác' })).toHaveTextContent('1 thẻ mới');
    expect(screen.getByRole('region', { name: 'Kế hoạch thao tác' })).not.toHaveTextContent('cột mới');
  });

  it('canh bao cua may chu (vd AI chi xem mot phan bang) van hien; ke hoach thuong KHONG co ghi chu "do AI de xuat"', () => {
    renderCard(turnOf({ kind: 'PLAN', plan: patchPlan({ warnings: ['AI chỉ xem 150/420 thẻ của bảng; mình vẫn kiểm tra trùng trên toàn bộ thẻ.'] }) }));
    expect(screen.getByText('AI chỉ xem 150/420 thẻ của bảng; mình vẫn kiểm tra trùng trên toàn bộ thẻ.')).toBeInTheDocument();
    cleanup();
    renderCard(turnOf({ kind: 'PLAN', plan: plan() }));
    expect(screen.queryByText('Nội dung do AI đề xuất')).not.toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('Thao tác trên bảng');
  });

  it('o trang bang khac thi khoa nut Ap dung (tran pham vi theo trang) du la Board Patch', () => {
    const { onConfirm } = renderCard(turnOf({ kind: 'PLAN', plan: patchPlan() }), { kind: 'BOARD', boardId: 'b2' });
    expect(screen.getByRole('button', { name: 'Áp dụng 3 thay đổi' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng 3 thay đổi' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ket qua cua Board Patch: hien cau tom tat "Da them ..." va tung buoc', () => {
    renderCard(turnOf({ kind: 'RESULT', result: result({ opCount: 3, cardId: undefined, summary: 'Đã thêm 1 cột và 2 thẻ vào bảng “Dự án Alpha”. Dữ liệu cũ được giữ nguyên.', details: ['Đã tạo cột “Kiểm thử”.', 'Đã tạo thẻ “A” trong cột “Kiểm thử”.', 'Đã tạo thẻ “B” trong cột “Cần làm”.'] }) }));
    expect(screen.getByText('Đã thêm 1 cột và 2 thẻ vào bảng “Dự án Alpha”. Dữ liệu cũ được giữ nguyên.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});

// ===================== Phase 6: nguoi nhan do he thong goi y phan cong chon =====================

describe('ActionCard: nguoi nhan do he thong chon (goi y phan cong)', () => {
  const assignPlan = (over: Partial<ChatActionPlan> = {}): ChatActionPlan =>
    plan({
      risk: 'MEDIUM',
      reasons: [{ code: 'AI_CHOSEN_TARGET', text: 'Người nhận do hệ thống gợi ý phân công chọn (không phải tên bạn nêu) nên mình luôn cho bạn xem điểm, độ tin cậy, cờ cảnh báo và ứng viên khác trước khi áp dụng.' }],
      opCount: 1,
      items: [{
        index: 0, verb: 'Giao thẻ', text: '“Thiết kế quên mật khẩu” cho Nguyễn Lan', cardId: 'c1',
        choice: { source: 'BEST', rank: 1, score: 82, confidenceLevel: 'GOOD', flags: ['OVERLOADED'], alternatives: [{ name: 'Trần Tuấn', rank: 2, score: 64 }, { name: 'Chủ Bảng', rank: 3, score: null }] },
      }],
      warnings: [], ...over,
    });

  it('hien nguoi do may chon: hang, diem, do tin cay, canh bao co, ung vien khac (khong co bang chung / runId); ly do AI_CHOSEN_TARGET', () => {
    const { onConfirm } = renderCard(turnOf({ kind: 'PLAN', plan: assignPlan() }));
    const block = screen.getByRole('region', { name: 'Kế hoạch thao tác' });
    expect(block).toHaveTextContent('Giao thẻ “Thiết kế quên mật khẩu” cho Nguyễn Lan');
    expect(block).toHaveTextContent('Do hệ thống gợi ý phân công chọn · hạng 1 · điểm 82/100 · Đủ dữ liệu');
    expect(block).toHaveTextContent('Lưu ý: đang quá tải');
    expect(block).toHaveTextContent('Ứng viên khác: Trần Tuấn (64), Chủ Bảng');
    expect(within(block).getByRole('note')).toHaveTextContent('do hệ thống gợi ý phân công chọn');
    fireEvent.click(within(block).getByRole('button', { name: 'Áp dụng' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('diem luon la so nguyen: khong bao gio hien 72.4999… / 50.000000000000014 du du lieu gui ve la so thuc', () => {
    renderCard(turnOf({ kind: 'PLAN', plan: assignPlan({ items: [{ index: 0, verb: 'Giao thẻ', text: '“A” cho Lan', choice: { source: 'BEST', rank: 1, score: 72.49999999999999, confidenceLevel: 'FAIR', flags: [], alternatives: [{ name: 'Chủ Bảng', rank: 2, score: 50.00000000000014 }, { name: 'Lan', rank: 3, score: 27.5 }] } }] }) }));
    const block = screen.getByRole('region', { name: 'Kế hoạch thao tác' });
    expect(block).toHaveTextContent('điểm 72/100');
    expect(block).toHaveTextContent('Ứng viên khác: Chủ Bảng (50), Lan (28)');
    expect(block.textContent).not.toMatch(/\d\.\d/);
  });

  it('luat tu dong hoa: hien dieu kien, tung viec se lam va ghi chu "chay bang quyen cua ban" thay vi mot dong ten dai', () => {
    const rulePlan = plan({
      risk: 'HIGH',
      reasons: [{ code: 'STANDING_RULE', text: 'Luật tự động hóa chạy LÂU DÀI mỗi khi điều kiện xảy ra, bằng quyền của bạn nên mình luôn cho bạn xem lại trước khi áp dụng.' }],
      opCount: 1,
      warnings: [],
      items: [{
        index: 0, verb: 'Tạo luật tự động hóa', text: '“Khi thẻ được chuyển vào cột “Done”: gắn nhãn “Hoàn thành”, giao thẻ cho Lan”',
        rule: { when: 'Khi thẻ được chuyển vào cột “Done”', then: ['gắn nhãn “Hoàn thành”', 'giao thẻ cho Lan'], note: 'Luật chạy bằng quyền của bạn: mỗi lần điều kiện xảy ra, hệ thống tự làm các việc trên với danh nghĩa bạn.' },
      }],
    });
    const { onConfirm } = renderCard(turnOf({ kind: 'PLAN', plan: rulePlan }));
    const block = screen.getByRole('region', { name: 'Kế hoạch thao tác' });
    expect(block).toHaveTextContent('Tạo luật tự động hóa');
    expect(block).toHaveTextContent('Khi thẻ được chuyển vào cột “Done”');
    expect(within(block).getAllByRole('listitem').map((li) => li.textContent)).toEqual(expect.arrayContaining(['gắn nhãn “Hoàn thành”', 'giao thẻ cho Lan']));
    expect(block).toHaveTextContent('Luật chạy bằng quyền của bạn');
    expect(within(block).getByRole('note')).toHaveTextContent('chạy LÂU DÀI');
    expect(block.textContent).not.toContain('“Khi thẻ được chuyển vào cột “Done”: gắn nhãn'); // không lặp lại tên luật dài
    fireEvent.click(within(block).getByRole('button', { name: 'Áp dụng' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('khong co diem (chua du du lieu) van noi ro; thao tac nguoi dung tu goi ten thi khong co dong "do he thong chon"', () => {
    renderCard(turnOf({ kind: 'PLAN', plan: assignPlan({ items: [{ index: 0, verb: 'Giao thẻ', text: '“A” cho Lan', choice: { source: 'PLAN', rank: 2, score: null, confidenceLevel: 'THIN', flags: [], alternatives: [] } }] }) }));
    expect(screen.getByRole('region', { name: 'Kế hoạch thao tác' })).toHaveTextContent('hạng 2 · chưa đủ dữ liệu để chấm điểm · Dữ liệu mỏng');
    expect(screen.queryByText(/Ứng viên khác/)).not.toBeInTheDocument();
    cleanup();
    renderCard(turnOf({ kind: 'PLAN', plan: plan({ items: [{ index: 0, verb: 'Giao thẻ', text: '“A” cho Lan', cardId: 'c1' }] }) }));
    expect(screen.queryByText(/Do hệ thống gợi ý phân công chọn/)).not.toBeInTheDocument();
  });
});

// ---------- Buoc D: noi dung van ban + luu tru ----------
describe('ActionCard: thao tac noi dung (mo ta, binh luan, checklist) va luu tru', () => {
  it('chi tiet nhieu dong (checklist) giu xuong dong; ban xem truoc hien ly do TEXT_CONTENT', () => {
    const turn = turnOf({ kind: 'PLAN', plan: plan({
      risk: 'MEDIUM', warnings: [], opCount: 1,
      reasons: [{ code: 'TEXT_CONTENT', text: 'Mô tả, bình luận và checklist là nội dung văn bản mà người khác trong bảng sẽ đọc nên mình luôn cho bạn xem lại trước khi áp dụng.' }],
      items: [{ index: 0, verb: 'Thêm checklist', text: '“Kiểm thử” vào thẻ “Login UI”', detail: '• unit test\n• api test', cardId: 'c1' }],
    }) });
    renderCard(turn);
    const block = screen.getByRole('region', { name: 'Kế hoạch thao tác' });
    const detail = within(block).getByText(/unit test/);
    expect(detail.className).toContain('whitespace-pre-line');
    expect(detail.textContent).toBe('• unit test\n• api test');
    expect(within(block).getByRole('note')).toHaveTextContent('nội dung văn bản mà người khác trong bảng sẽ đọc');
  });

  it('lưu trữ: ghi rõ khôi phục được; nội dung bình luận hiện nguyên văn như chữ thuần (không dựng HTML)', () => {
    const turn = turnOf({ kind: 'PLAN', plan: plan({
      warnings: [],
      reasons: [{ code: 'ARCHIVE', text: 'Lưu trữ sẽ ẩn thẻ khỏi bảng.' }],
      items: [
        { index: 0, verb: 'Viết bình luận', text: 'vào thẻ “Login UI”', detail: '<img src=x onerror=alert(1)> xong rồi' },
        { index: 1, verb: 'Lưu trữ thẻ', text: '“Login UI”', detail: 'Thẻ sẽ ẩn khỏi bảng; khôi phục lại được trong mục Lưu trữ của bảng.' },
      ],
    }) });
    renderCard(turn);
    const block = screen.getByRole('region', { name: 'Kế hoạch thao tác' });
    expect(block.querySelector('img')).toBeNull();
    expect(block).toHaveTextContent('<img src=x onerror=alert(1)> xong rồi');
    expect(block).toHaveTextContent('khôi phục lại được trong mục Lưu trữ');
  });
});

describe('ActionCard: thao tac xoa (canh bao, khong khoi phuc duoc)', () => {
  it('muc xoa duoc to mau canh bao, nut Ap dung doi mau do; ly do DELETE hien ro; thao tac khong xoa thi giu mau thuong', () => {
    const turn = turnOf({ kind: 'PLAN', plan: plan({
      risk: 'HIGH', warnings: [],
      reasons: [{ code: 'DELETE', text: 'Xóa là thẻ, cột, bình luận hoặc tệp biến mất khỏi bảng và không khôi phục lại được ở giao diện.' }],
      items: [{ index: 0, verb: 'Xóa cột', text: '“5”', detail: 'Cột cùng 2 thẻ trong cột biến mất khỏi bảng và không khôi phục lại được ở giao diện.', danger: true }],
    }) });
    renderCard(turn);
    const block = screen.getByRole('region', { name: 'Kế hoạch thao tác' });
    expect(block.className).toContain('border-red-300');
    expect(within(block).getByText('Xóa cột').className).toContain('text-red-700');
    expect(within(block).getByRole('button', { name: 'Áp dụng' }).className).toContain('bg-red-600');
    expect(within(block).getByRole('note')).toHaveTextContent('không khôi phục lại được ở giao diện');
    cleanup();
    renderCard(turnOf({ kind: 'PLAN', plan: plan() }));
    const normal = screen.getByRole('region', { name: 'Kế hoạch thao tác' });
    expect(normal.className).not.toContain('border-red-300');
    expect(within(normal).getByRole('button', { name: 'Áp dụng' }).className).toContain('bg-primary');
  });
});
