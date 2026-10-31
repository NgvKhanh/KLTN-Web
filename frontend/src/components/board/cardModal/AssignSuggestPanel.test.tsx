import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosError } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignSuggestion, AssignSuggestionResult } from '../../../types/assign';
import type { BoardMember } from '../../../types/board';
import AssignSuggestPanel from './AssignSuggestPanel';

// Ô "Thành viên" có gợi ý: mock lớp gọi API (đã có test riêng ở lib/api/assign.test.ts) và kiểm HÀNH VI nhìn thấy được:
// xếp hạng, giá trị thô, cảnh báo trước khi giao, ghi lựa chọn đúng một lần, và rơi về danh sách thường khi gợi ý lỗi.

const mocks = vi.hoisted(() => ({ fetchAssignSuggestions: vi.fn(), recordAssignOutcome: vi.fn() }));
vi.mock('../../../lib/api/assign', () => ({
  fetchAssignSuggestions: mocks.fetchAssignSuggestions,
  recordAssignOutcome: mocks.recordAssignOutcome,
  userCvUrl: (id: string) => `http://api.test/users/${id}/assign-profile/cv`,
}));

const member = (id: string, name: string, role: BoardMember['role'] = 'MEMBER'): BoardMember => ({
  id: `bm-${id}`,
  boardId: 'b1',
  userId: id,
  role,
  user: { id, name, email: `${id}@x.vn`, avatarUrl: null },
});

const comp = (value: number | null) => ({ value, weight: 0.3, scaled: value, share: 0.3 });

function sug(id: string, name: string, rank: number, over: Partial<AssignSuggestion> = {}): AssignSuggestion {
  return {
    rank,
    user: { id, name, avatarUrl: null },
    score: 78.4,
    rawScore: 61.2,
    confidence: 0.62,
    confidenceLevel: 'GOOD',
    components: { experience: comp(0.71), reliability: comp(1), availability: comp(0.4), declared: comp(0.55) },
    fit: 0.7,
    evidenceMass: 3,
    load: 2,
    capacity: 5,
    flags: [],
    assigned: false,
    evidence: [],
    declaredEvidence: [],
    cvAvailable: false,
    ...over,
  };
}

function result(candidates: AssignSuggestion[], over: Partial<AssignSuggestionResult> = {}): AssignSuggestionResult {
  return {
    runId: 'run-1',
    card: { id: 'c1', title: 'Thiết kế màn hình đăng nhập', boardId: 'b1', workspaceId: 'w1' },
    algorithmVersion: 'knn-tfidf-v2/minmax/drop+decl-neutral',
    generatedAt: '2026-09-20T05:00:00.000Z',
    weights: { experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2, custom: false },
    groupOnTimeRate: 0.6,
    candidateCount: candidates.length,
    candidates,
    ...over,
  };
}

const MEMBERS = [member('u1', 'Lan Nguyễn'), member('u2', 'Bình Trần'), member('u3', 'Chi Lê'), member('v1', 'Khách xem', 'VIEWER')];

function setup(opts: { members?: BoardMember[]; assigned?: string[]; onAdd?: (id: string) => Promise<boolean>; onRemove?: (id: string) => Promise<boolean>; cardId?: string } = {}) {
  const onAdd = vi.fn(opts.onAdd ?? (() => Promise.resolve(true)));
  const onRemove = vi.fn(opts.onRemove ?? (() => Promise.resolve(true)));
  const ui = (cardId: string, assigned: string[]) => (
    <MemoryRouter>
      <AssignSuggestPanel
        cardId={cardId}
        boardMembers={opts.members ?? MEMBERS}
        cardMemberIds={new Set(assigned)}
        onAdd={onAdd}
        onRemove={onRemove}
      />
    </MemoryRouter>
  );
  const view = render(ui(opts.cardId ?? 'c1', opts.assigned ?? []));
  return { onAdd, onRemove, ...view, rerenderWith: (cardId: string, assigned: string[] = opts.assigned ?? []) => view.rerender(ui(cardId, assigned)) };
}

const rows = () => screen.getAllByTestId(/^assign-row-/).map((el) => el.getAttribute('data-testid'));
const flush = () => act(async () => {});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.recordAssignOutcome.mockResolvedValue({});
});

describe('AssignSuggestPanel - hiển thị gợi ý', () => {
  it('đang tải -> khung chờ; xong -> các dòng THEO THỨ TỰ máy chủ, kèm hạng, điểm tương đối, bốn giá trị THÔ, mức dữ liệu và trọng số nhóm', async () => {
    let resolve!: (r: AssignSuggestionResult) => void;
    mocks.fetchAssignSuggestions.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    expect(screen.getByRole('status')).toHaveTextContent('Đang tính gợi ý');
    expect(screen.queryByTestId('assign-row-u1')).not.toBeInTheDocument();

    await act(async () => resolve(result([sug('u2', 'Bình Trần', 1), sug('u1', 'Lan Nguyễn', 2, { score: 41.6, components: { experience: comp(0.2), reliability: comp(0.5), availability: comp(1), declared: comp(0.08) }, confidenceLevel: 'THIN' }), sug('u3', 'Chi Lê', 3)])));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(rows()).toEqual(['assign-row-u2', 'assign-row-u1', 'assign-row-u3']);

    const top = within(screen.getByTestId('assign-row-u2'));
    expect(top.getByText('1')).toBeInTheDocument();
    expect(top.getByText('Bình Trần')).toBeInTheDocument();
    expect(top.getByText('Phù hợp 78')).toBeInTheDocument();
    expect(top.getByText('KN 71%')).toBeInTheDocument();
    expect(top.getByText('TC 100%')).toBeInTheDocument();
    expect(top.getByText('KD 40%')).toBeInTheDocument();
    expect(top.getByText('HS 55%')).toBeInTheDocument();
    expect(top.getByText('Đủ dữ liệu')).toBeInTheDocument();

    const second = within(screen.getByTestId('assign-row-u1'));
    expect(second.getByText('Phù hợp 42')).toBeInTheDocument();
    expect(second.getByText('KN 20%')).toBeInTheDocument();
    expect(second.getByText('KD 100%')).toBeInTheDocument();
    expect(second.getByText('HS 8%')).toBeInTheDocument();
    expect(second.getByText('Dữ liệu mỏng')).toBeInTheDocument();

    expect(screen.getByText(/Trọng số nhóm: Kinh nghiệm 36% · Tin cậy 24% · Khả dụng 20% · Hồ sơ 20%\./)).toBeInTheDocument();
    expect(screen.queryByText(/đã tuỳ chỉnh/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem / chỉnh' })).toHaveAttribute('href', '/workspaces/w1');
  });

  it('trọng số đã tuỳ chỉnh và đã HỌC (lẻ) hiện làm tròn phần trăm, kèm "(đã tuỳ chỉnh)"', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(
      result([sug('u1', 'Lan Nguyễn', 1)], { weights: { experience: 0.306, reliability: 0.2445, availability: 0.253, declared: 0.1965, custom: true } })
    );
    setup();
    expect(await screen.findByText(/Trọng số nhóm: Kinh nghiệm 31% · Tin cậy 24% · Khả dụng 25% · Hồ sơ 20% \(đã tuỳ chỉnh\)\./)).toBeInTheDocument();
  });

  it('thành phần chưa có dữ liệu hiện "—"; điểm null hiện "Chưa đủ dữ liệu để chấm"; cờ hiện đủ nhãn (quá tải ghi số thẻ)', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(
      result([
        sug('u1', 'Lan Nguyễn', 1, { score: null, components: { experience: comp(null), reliability: comp(null), availability: comp(0.6), declared: comp(null) }, flags: ['NO_HISTORY', 'NO_PROFILE', 'NO_DATA'], confidenceLevel: 'THIN' }),
        sug('u2', 'Bình Trần', 2, { load: 6, capacity: 5, flags: ['OVERLOADED', 'PAUSED', 'NO_SIMILAR'] }),
      ])
    );
    setup();
    await screen.findByTestId('assign-row-u1');
    const a = within(screen.getByTestId('assign-row-u1'));
    expect(a.getByText('Chưa đủ dữ liệu để chấm')).toBeInTheDocument();
    expect(a.getByText('KN —')).toBeInTheDocument();
    expect(a.getByText('TC —')).toBeInTheDocument();
    expect(a.getByText('KD 60%')).toBeInTheDocument();
    expect(a.getByText('HS —')).toBeInTheDocument();
    expect(a.getByText('Chưa có lịch sử')).toBeInTheDocument();
    expect(a.getByText('Chưa khai hồ sơ')).toBeInTheDocument();
    expect(a.getByText('Không đủ dữ liệu')).toBeInTheDocument();
    const b = within(screen.getByTestId('assign-row-u2'));
    expect(b.getByText('Quá tải (6/5 thẻ)')).toBeInTheDocument();
    expect(b.getByText('Đang tạm nghỉ')).toBeInTheDocument();
    expect(b.getByText('Chưa làm việc tương tự')).toBeInTheDocument();
  });

  it('thành viên bảng KHÔNG nằm trong gợi ý (VIEWER) vẫn liệt kê ở dưới, không có điểm', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(result([sug('u1', 'Lan Nguyễn', 1), sug('u2', 'Bình Trần', 2), sug('u3', 'Chi Lê', 3)]));
    setup();
    await screen.findByTestId('assign-row-u1');
    expect(screen.getByRole('button', { name: /Khách xem/ })).toBeInTheDocument();
    expect(screen.queryByTestId('assign-row-v1')).not.toBeInTheDocument();
    // Nguoi da co diem chi hien MOT dong (khong bi lap them dong thuong)
    for (const name of ['Lan Nguyễn', 'Bình Trần', 'Chi Lê']) expect(screen.getAllByText(name), name).toHaveLength(1);
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons.findIndex((t) => t?.includes('Khách xem'))).toBeGreaterThan(buttons.findIndex((t) => t?.includes('Chi Lê')));
  });

  it('"Vì sao?": mở/đóng bằng chứng (tiêu đề, độ giống, kết quả, ngày); tiêu đề bị che hiện "Thẻ ở bảng riêng tư"; rỗng thì nói rõ lý do', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(
      result([
        sug('u1', 'Lan Nguyễn', 1, {
          evidence: [
            { cardId: 'k1', title: 'Thiết kế màn hình đăng ký', sim: 0.83, weight: 0.9, outcome: 'ON_TIME', completedAt: new Date(2026, 8, 1, 12).toISOString(), dueDate: null },
            { cardId: 'k2', title: null, sim: 0.4, weight: 0.5, outcome: 'LATE', completedAt: new Date(2026, 7, 5, 12).toISOString(), dueDate: null },
          ],
        }),
        sug('u2', 'Bình Trần', 2, { flags: ['NO_HISTORY'], evidence: [] }),
        sug('u3', 'Chi Lê', 3, { flags: ['NO_SIMILAR'], evidence: [] }),
      ])
    );
    setup();
    await screen.findByTestId('assign-row-u1');
    const why1 = screen.getByRole('button', { name: 'Vì sao gợi ý Lan Nguyễn' });
    expect(why1).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Thiết kế màn hình đăng ký')).not.toBeInTheDocument();

    fireEvent.click(why1);
    expect(why1).toHaveAttribute('aria-expanded', 'true');
    const row = within(screen.getByTestId('assign-row-u1'));
    expect(row.getByText('Thiết kế màn hình đăng ký')).toBeInTheDocument();
    expect(row.getByText(/83% giống · Đúng hạn · 01\/09\/2026/)).toBeInTheDocument();
    expect(row.getByText('Thẻ ở bảng riêng tư')).toBeInTheDocument();
    expect(row.getByText(/40% giống · Trễ hạn · 05\/08\/2026/)).toBeInTheDocument();

    // Mở dòng khác thì đóng dòng cũ; đóng lại được
    fireEvent.click(screen.getByRole('button', { name: 'Vì sao gợi ý Bình Trần' }));
    expect(screen.queryByText('Thiết kế màn hình đăng ký')).not.toBeInTheDocument();
    expect(screen.getByText('Người này chưa hoàn thành thẻ nào trong không gian làm việc này.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vì sao gợi ý Chi Lê' }));
    expect(screen.getByText('Chưa có thẻ cũ nào đủ giống thẻ này.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vì sao gợi ý Chi Lê' }));
    expect(screen.queryByText('Chưa có thẻ cũ nào đủ giống thẻ này.')).not.toBeInTheDocument();
  });

  it('"Vì sao?" phần HỒ SƠ: mục khai khớp (loại, tên, độ giống; đoạn CV không có chữ), chưa khai / không khớp nói rõ; "Tải CV" chỉ khi máy chủ cho', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(
      result([
        sug('u1', 'Lan Nguyễn', 1, {
          cvAvailable: true,
          declaredEvidence: [
            { kind: 'CV', itemId: 'cv-3', title: null, sim: 0.91 },
            { kind: 'WORK', itemId: 'w1', title: 'Trang quản trị bán hàng', sim: 0.62 },
            { kind: 'SKILL', itemId: 's2', title: 'thiết kế giao diện', sim: 0.5 },
          ],
        }),
        sug('u2', 'Bình Trần', 2, { flags: ['NO_PROFILE'], cvAvailable: false }),
        sug('u3', 'Chi Lê', 3, { cvAvailable: true, components: { experience: comp(0.3), reliability: comp(1), availability: comp(0.4), declared: comp(0) } }),
      ])
    );
    setup();
    await screen.findByTestId('assign-row-u1');
    fireEvent.click(screen.getByRole('button', { name: 'Vì sao gợi ý Lan Nguyễn' }));
    const row = within(screen.getByTestId('assign-row-u1'));
    expect(row.getByText(/Khớp hồ sơ tự khai/)).toBeInTheDocument();
    expect(row.getByText('(chưa kiểm chứng)')).toBeInTheDocument();
    const items = row.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      'CV: một đoạn trong CV — 91% giống',
      'Công việc đã làm: Trang quản trị bán hàng — 62% giống',
      'Kỹ năng: thiết kế giao diện — 50% giống',
    ]);
    expect(row.getByRole('link', { name: 'Tải CV' })).toHaveAttribute('href', 'http://api.test/users/u1/assign-profile/cv');

    fireEvent.click(screen.getByRole('button', { name: 'Vì sao gợi ý Bình Trần' }));
    const b = within(screen.getByTestId('assign-row-u2'));
    expect(b.getByText('Chưa khai hồ sơ kỹ năng.')).toBeInTheDocument();
    expect(b.queryByRole('link', { name: 'Tải CV' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Vì sao gợi ý Chi Lê' }));
    const c = within(screen.getByTestId('assign-row-u3'));
    expect(c.getByText(/Hồ sơ tự khai không có mục nào đủ giống thẻ này\./)).toBeInTheDocument();
    expect(c.getByRole('link', { name: 'Tải CV' })).toHaveAttribute('href', 'http://api.test/users/u3/assign-profile/cv');
  });
});

describe('AssignSuggestPanel - giao thẻ và ghi lựa chọn', () => {
  it('bấm một dòng -> onAdd(userId) rồi recordAssignOutcome(runId, userId) ĐÚNG MỘT LẦN; người thứ hai cùng lượt KHÔNG ghi thêm', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(result([sug('u1', 'Lan Nguyễn', 1), sug('u2', 'Bình Trần', 2)]));
    const { onAdd } = setup();
    await screen.findByTestId('assign-row-u1');

    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Lan Nguyễn' }));
    await waitFor(() => expect(mocks.recordAssignOutcome).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith('u1');
    expect(mocks.recordAssignOutcome).toHaveBeenCalledWith('run-1', 'u1');

    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Bình Trần' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('u2'));
    await flush();
    expect(mocks.recordAssignOutcome).toHaveBeenCalledTimes(1);
  });

  it('onAdd thất bại (false) -> KHÔNG ghi lựa chọn; sau đó giao thành công thì mới ghi', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(result([sug('u1', 'Lan Nguyễn', 1), sug('u2', 'Bình Trần', 2)]));
    const results = [false, true];
    const { onAdd } = setup({ onAdd: () => Promise.resolve(results.shift()!) });
    await screen.findByTestId('assign-row-u1');
    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Lan Nguyễn' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    await flush();
    expect(mocks.recordAssignOutcome).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Bình Trần' }));
    await waitFor(() => expect(mocks.recordAssignOutcome).toHaveBeenCalledWith('run-1', 'u2'));
  });

  it('người đã trong thẻ: hiện "Đã trong thẻ"; bấm -> onRemove, KHÔNG ghi lựa chọn', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(result([sug('u1', 'Lan Nguyễn', 1), sug('u2', 'Bình Trần', 2)]));
    const { onAdd, onRemove } = setup({ assigned: ['u1'] });
    await screen.findByTestId('assign-row-u1');
    expect(within(screen.getByTestId('assign-row-u1')).getByText(/Đã trong thẻ/)).toBeInTheDocument();
    expect(within(screen.getByTestId('assign-row-u2')).queryByText(/Đã trong thẻ/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Bỏ Lan Nguyễn khỏi thẻ' }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('u1'));
    await flush();
    expect(onAdd).not.toHaveBeenCalled();
    expect(mocks.recordAssignOutcome).not.toHaveBeenCalled();
  });

  it('runId = null (không có gợi ý nào được ghi) -> thêm được nhưng không ghi lựa chọn', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(result([sug('u1', 'Lan Nguyễn', 1)], { runId: null }));
    const { onAdd } = setup();
    await screen.findByTestId('assign-row-u1');
    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Lan Nguyễn' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('u1'));
    await flush();
    expect(mocks.recordAssignOutcome).not.toHaveBeenCalled();
  });

  it('ghi lựa chọn LỖI (vd 409) không làm vỡ giao diện: chỉ ghi log, ô vẫn dùng được', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mocks.recordAssignOutcome.mockRejectedValue(new Error('409'));
      mocks.fetchAssignSuggestions.mockResolvedValue(result([sug('u1', 'Lan Nguyễn', 1)]));
      const { onAdd } = setup();
      await screen.findByTestId('assign-row-u1');
      fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Lan Nguyễn' }));
      await waitFor(() => expect(log).toHaveBeenCalled());
      expect(onAdd).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('assign-row-u1')).toBeInTheDocument();
    } finally {
      log.mockRestore();
    }
  });

  it('trong lúc đang giao, các nút bị khoá (không giao hai người cùng lúc)', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(result([sug('u1', 'Lan Nguyễn', 1), sug('u2', 'Bình Trần', 2)]));
    let finish!: (ok: boolean) => void;
    const { onAdd } = setup({ onAdd: () => new Promise<boolean>((r) => (finish = r)) });
    await screen.findByTestId('assign-row-u1');
    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Lan Nguyễn' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Giao thẻ cho Bình Trần' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Bình Trần' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    await act(async () => finish(true));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Giao thẻ cho Bình Trần' })).toBeEnabled());
  });
});

describe('AssignSuggestPanel - cảnh báo khi giao cho người quá tải / tạm nghỉ', () => {
  const risky = () =>
    result([
      sug('u1', 'Lan Nguyễn', 1),
      sug('u2', 'Bình Trần', 2, { load: 6, capacity: 5, flags: ['OVERLOADED'] }),
      sug('u3', 'Chi Lê', 3, { flags: ['PAUSED', 'OVERLOADED'], load: 3, capacity: 3 }),
      sug('u4', 'Dũng Võ', 4, { flags: ['NO_HISTORY', 'NO_SIMILAR', 'NO_DATA'] }),
    ]);
  const MEM = [member('u1', 'Lan Nguyễn'), member('u2', 'Bình Trần'), member('u3', 'Chi Lê'), member('u4', 'Dũng Võ')];

  it('QUÁ TẢI: bấm lần 1 chỉ hiện cảnh báo (chưa giao); "Vẫn giao" mới giao + ghi lựa chọn; cảnh báo biến mất', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(risky());
    const { onAdd } = setup({ members: MEM });
    await screen.findByTestId('assign-row-u2');
    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Bình Trần' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Bình Trần đang quá tải (6/5 thẻ chồng lấn). Vẫn giao thẻ này?');
    expect(onAdd).not.toHaveBeenCalled();
    expect(mocks.recordAssignOutcome).not.toHaveBeenCalled();

    fireEvent.click(within(alert).getByRole('button', { name: 'Vẫn giao' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('u2'));
    await waitFor(() => expect(mocks.recordAssignOutcome).toHaveBeenCalledWith('run-1', 'u2'));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('"Huỷ" đóng cảnh báo, không giao, không ghi lựa chọn', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(risky());
    const { onAdd } = setup({ members: MEM });
    await screen.findByTestId('assign-row-u2');
    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Bình Trần' }));
    fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await flush();
    expect(onAdd).not.toHaveBeenCalled();
    expect(mocks.recordAssignOutcome).not.toHaveBeenCalled();
  });

  it('TẠM NGHỈ + QUÁ TẢI: câu cảnh báo nói cả hai; bấm lần thứ hai vào chính dòng đó cũng xác nhận', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(risky());
    const { onAdd } = setup({ members: MEM });
    await screen.findByTestId('assign-row-u3');
    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Chi Lê' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chi Lê đang tạm nghỉ và đang quá tải (3/3 thẻ chồng lấn).');
    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Chi Lê' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('u3'));
  });

  it('cờ KHÁC (chưa có lịch sử, chưa làm việc tương tự, không đủ dữ liệu) và người bình thường: giao NGAY, không hỏi', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(risky());
    const { onAdd } = setup({ members: MEM });
    await screen.findByTestId('assign-row-u4');
    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Dũng Võ' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('u4'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Lan Nguyễn' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('u1'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('bỏ một người đang quá tải khỏi thẻ KHÔNG hỏi lại (chỉ giao mới hỏi)', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(risky());
    const { onRemove } = setup({ members: MEM, assigned: ['u2'] });
    await screen.findByTestId('assign-row-u2');
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ Bình Trần khỏi thẻ' }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('u2'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('AssignSuggestPanel - gợi ý lỗi thì giao tay vẫn dùng được', () => {
  it('lỗi thường -> thông báo chung + danh sách thường (mọi thành viên bảng) + giao được nhưng KHÔNG ghi lựa chọn', async () => {
    mocks.fetchAssignSuggestions.mockRejectedValue(new Error('mạng lỗi'));
    const { onAdd } = setup();
    expect(await screen.findByText(/Chưa lấy được gợi ý lúc này\. Bạn vẫn giao thẻ bằng tay được\./)).toBeInTheDocument();
    for (const name of ['Lan Nguyễn', 'Bình Trần', 'Chi Lê', 'Khách xem']) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByTestId(/^assign-row-/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Bình Trần/ }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('u2'));
    await flush();
    expect(mocks.recordAssignOutcome).not.toHaveBeenCalled();
  });

  it('lỗi giới hạn tốc độ (429): hiện đúng thông điệp của máy chủ; "Thử lại" gọi lại và hiện gợi ý', async () => {
    const tooMany = new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 429,
      statusText: 'Too Many Requests',
      headers: {},
      config: {} as never,
      data: { success: false, message: 'Ban thao tac qua nhieu lan. Vui long thu lai sau it phut.' },
    });
    let resolveRetry!: (r: AssignSuggestionResult) => void;
    mocks.fetchAssignSuggestions.mockRejectedValueOnce(tooMany).mockReturnValueOnce(new Promise((r) => (resolveRetry = r)));
    setup();
    expect(await screen.findByText(/Ban thao tac qua nhieu lan\. Vui long thu lai sau it phut\. Bạn vẫn giao/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    // Bấm Thử lại là quay NGAY về trạng thái đang tải (không để nguyên thông báo lỗi cũ trong lúc chờ)
    expect(screen.getByRole('status')).toHaveTextContent('Đang tính gợi ý');
    expect(screen.queryByText(/Ban thao tac qua nhieu lan/)).not.toBeInTheDocument();
    await act(async () => resolveRetry(result([sug('u1', 'Lan Nguyễn', 1)])));
    expect(await screen.findByTestId('assign-row-u1')).toBeInTheDocument();
    expect(mocks.fetchAssignSuggestions).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Bạn vẫn giao thẻ bằng tay/)).not.toBeInTheDocument();
  });
});

describe('AssignSuggestPanel - chi tiết hiển thị', () => {
  it('điểm ngoài [0; 100] được kẹp khi vẽ thanh (không tràn khung); cờ quá tải / tạm nghỉ có màu cảnh báo, cờ khác thì không', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(
      result([
        sug('u1', 'Lan Nguyễn', 1, { score: 130 }),
        sug('u2', 'Bình Trần', 2, { score: -5, flags: ['OVERLOADED', 'NO_HISTORY'] }),
      ])
    );
    setup();
    await screen.findByTestId('assign-row-u1');
    const widthOf = (id: string) => {
      // khung co title -> thanh nen (track) -> phan to mau (fill) mang chieu rong
      const fill = within(screen.getByTestId(id)).getByTitle(/Điểm tương đối/).firstElementChild!.firstElementChild as HTMLElement;
      return fill.style.width;
    };
    expect(widthOf('assign-row-u1')).toBe('100%');
    expect(widthOf('assign-row-u2')).toBe('0%');
    const row2 = within(screen.getByTestId('assign-row-u2'));
    expect(row2.getByText(/Quá tải/).className).toContain('amber');
    expect(row2.getByText('Chưa có lịch sử').className).not.toContain('amber');
  });
});

describe('AssignSuggestPanel - đổi thẻ và ghi lựa chọn', () => {
  it('đã ghi lựa chọn ở thẻ này rồi chuyển sang thẻ khác: thẻ mới lại ghi được MỘT lần (không bị khoá bởi thẻ cũ)', async () => {
    mocks.fetchAssignSuggestions
      .mockResolvedValueOnce(result([sug('u1', 'Lan Nguyễn', 1)], { runId: 'run-1' }))
      .mockResolvedValueOnce(result([sug('u2', 'Bình Trần', 1)], { runId: 'run-2', card: { id: 'c2', title: 'Thẻ hai', boardId: 'b1', workspaceId: 'w1' } }));
    const { rerenderWith } = setup({ cardId: 'c1' });
    await screen.findByTestId('assign-row-u1');
    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Lan Nguyễn' }));
    await waitFor(() => expect(mocks.recordAssignOutcome).toHaveBeenCalledWith('run-1', 'u1'));

    rerenderWith('c2');
    await screen.findByTestId('assign-row-u2');
    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Bình Trần' }));
    await waitFor(() => expect(mocks.recordAssignOutcome).toHaveBeenCalledWith('run-2', 'u2'));
    expect(mocks.recordAssignOutcome).toHaveBeenCalledTimes(2);
  });
});

describe('AssignSuggestPanel - vòng đời gọi API', () => {
  it('gọi gợi ý ĐÚNG MỘT LẦN khi mở, kể cả trong React.StrictMode (dùng chung yêu cầu đang bay); đổi thẻ thì gọi lại', async () => {
    mocks.fetchAssignSuggestions.mockResolvedValue(result([sug('u1', 'Lan Nguyễn', 1)]));
    const onAdd = vi.fn();
    const ui = (cardId: string) => (
      <StrictMode>
        <MemoryRouter>
          <AssignSuggestPanel cardId={cardId} boardMembers={MEMBERS} cardMemberIds={new Set()} onAdd={onAdd} onRemove={onAdd} />
        </MemoryRouter>
      </StrictMode>
    );
    const view = render(ui('c1'));
    await screen.findByTestId('assign-row-u1');
    expect(mocks.fetchAssignSuggestions).toHaveBeenCalledTimes(1);
    expect(mocks.fetchAssignSuggestions).toHaveBeenCalledWith('c1');

    mocks.fetchAssignSuggestions.mockResolvedValue(result([sug('u2', 'Bình Trần', 1)], { card: { id: 'c2', title: 'Thẻ hai', boardId: 'b1', workspaceId: 'w1' } }));
    view.rerender(ui('c2'));
    // Dang tai the moi: KHONG con hien goi y cua the cu (du ket qua cu van nam trong bo nho)
    expect(screen.queryByTestId('assign-row-u1')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Đang tính gợi ý');
    await screen.findByTestId('assign-row-u2');
    expect(mocks.fetchAssignSuggestions).toHaveBeenCalledTimes(2);
    expect(mocks.fetchAssignSuggestions).toHaveBeenLastCalledWith('c2');
    expect(screen.queryByTestId('assign-row-u1')).not.toBeInTheDocument();
  });

  it('đổi thẻ thì lượt ghi lựa chọn được làm mới (thẻ mới ghi được một lần nữa) và kết quả trả về muộn của thẻ cũ bị bỏ', async () => {
    let resolveOld!: (r: AssignSuggestionResult) => void;
    mocks.fetchAssignSuggestions
      .mockReturnValueOnce(new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce(result([sug('u2', 'Bình Trần', 1)], { runId: 'run-2', card: { id: 'c2', title: 'Thẻ hai', boardId: 'b1', workspaceId: 'w1' } }));
    const { rerenderWith, onAdd } = setup({ cardId: 'c1' });
    rerenderWith('c2');
    await screen.findByTestId('assign-row-u2');
    // Kết quả của thẻ cũ về muộn -> không ghi đè
    await act(async () => resolveOld(result([sug('u1', 'Lan Nguyễn', 1)], { runId: 'run-1' })));
    expect(screen.queryByTestId('assign-row-u1')).not.toBeInTheDocument();
    expect(screen.getByTestId('assign-row-u2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Giao thẻ cho Bình Trần' }));
    await waitFor(() => expect(mocks.recordAssignOutcome).toHaveBeenCalledWith('run-2', 'u2'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
