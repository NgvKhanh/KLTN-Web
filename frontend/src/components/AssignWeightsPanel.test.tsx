import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endOfLocalDayIso } from '../lib/assignDates';
import type { AssignProfile, AssignWeightsView } from '../types/assign';
import AssignWeightsPanel from './AssignWeightsPanel';

// Mục "Gợi ý phân công" của trang cài đặt không gian: thanh trượt tự cân bằng, lưu/đặt lại, trạng thái tự học, lịch sử,
// cấu hình làm việc của chính người xem. Lớp gọi API được mock (đã có test riêng ở lib/api/assign.test.ts).

const mocks = vi.hoisted(() => ({
  fetchAssignWeights: vi.fn(),
  saveAssignWeights: vi.fn(),
  resetAssignWeights: vi.fn(),
  fetchAssignProfile: vi.fn(),
  saveAssignProfile: vi.fn(),
}));
vi.mock('../lib/api/assign', () => ({
  fetchAssignWeights: mocks.fetchAssignWeights,
  saveAssignWeights: mocks.saveAssignWeights,
  resetAssignWeights: mocks.resetAssignWeights,
  fetchAssignProfile: mocks.fetchAssignProfile,
  saveAssignProfile: mocks.saveAssignProfile,
}));

const DEFAULTS = { experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2 };

function weightsView(over: Partial<AssignWeightsView> = {}): AssignWeightsView {
  return {
    workspaceId: 'w1',
    weights: { ...DEFAULTS },
    defaults: { ...DEFAULTS },
    custom: false,
    feedbackCount: 0,
    updatedAt: null,
    learning: { minFeedback: 10, eta: 0.05, active: false },
    feedback: { decided: 0, accepted: 0 },
    history: [],
    ...over,
  };
}

function profileView(over: Partial<AssignProfile> = {}): AssignProfile {
  return { workspaceId: 'w1', maxParallelCards: 5, defaultMaxParallelCards: 5, pausedUntil: null, isDefault: true, updatedAt: null, ...over };
}

const slider = (name: string) => screen.getByRole('slider', { name }) as HTMLInputElement;
const SLIDERS = ['Kinh nghiệm', 'Độ tin cậy', 'Khả dụng', 'Hồ sơ'];
const sliderValues = () => SLIDERS.map((n) => slider(n).value);

async function setup(opts: { canManage?: boolean; view?: AssignWeightsView; profile?: AssignProfile } = {}) {
  mocks.fetchAssignWeights.mockResolvedValue(opts.view ?? weightsView());
  mocks.fetchAssignProfile.mockResolvedValue(opts.profile ?? profileView());
  const utils = render(<AssignWeightsPanel workspaceId="w1" canManage={opts.canManage ?? true} />);
  await screen.findByText('Trọng số của nhóm');
  return utils;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('AssignWeightsPanel - tải và hiển thị', () => {
  it('đang tải -> "Đang tải…"; xong -> BỐN thanh trượt đúng 36 / 24 / 20 / 20 %, gọi API đúng không gian', async () => {
    let resolveW!: (v: AssignWeightsView) => void;
    mocks.fetchAssignWeights.mockReturnValue(new Promise((r) => (resolveW = r)));
    mocks.fetchAssignProfile.mockResolvedValue(profileView());
    render(<AssignWeightsPanel workspaceId="w1" canManage />);
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải');
    await act(async () => resolveW(weightsView()));
    expect(await screen.findByText('Trọng số của nhóm')).toBeInTheDocument();
    expect(sliderValues()).toEqual(['36', '24', '20', '20']);
    expect(screen.getByText('36%')).toBeInTheDocument();
    expect(screen.getByText('24%')).toBeInTheDocument();
    expect(screen.getAllByText('20%')).toHaveLength(2);
    expect(screen.getByText(/TỰ KHAI/)).toBeInTheDocument(); // chú thích thanh Hồ sơ
    expect(mocks.fetchAssignWeights).toHaveBeenCalledWith('w1');
    expect(mocks.fetchAssignProfile).toHaveBeenCalledWith('w1');
    // Thanh trượt có đủ giới hạn 5..70
    for (const n of SLIDERS) {
      expect(slider(n)).toHaveAttribute('min', '5');
      expect(slider(n)).toHaveAttribute('max', '70');
    }
  });

  it('lỗi tải -> thông báo + "Thử lại" gọi lại và hiện nội dung', async () => {
    mocks.fetchAssignWeights.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(weightsView());
    mocks.fetchAssignProfile.mockResolvedValue(profileView());
    render(<AssignWeightsPanel workspaceId="w1" canManage />);
    expect(await screen.findByText(/Không tải được cấu hình gợi ý phân công\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Trọng số của nhóm')).toBeInTheDocument();
    expect(mocks.fetchAssignWeights).toHaveBeenCalledTimes(2);
  });

  it('"Làm mới" tải lại; đổi không gian thì tải lại đúng không gian và bỏ kết quả cũ về muộn', async () => {
    const { rerender } = await setup();
    mocks.fetchAssignWeights.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    await waitFor(() => expect(mocks.fetchAssignWeights).toHaveBeenCalledTimes(1));

    let resolveOld!: (v: AssignWeightsView) => void;
    mocks.fetchAssignWeights.mockReturnValueOnce(new Promise((r) => (resolveOld = r)));
    mocks.fetchAssignProfile.mockResolvedValue(profileView());
    rerender(<AssignWeightsPanel workspaceId="w2" canManage />);
    // Dang tai khong gian moi: du lieu cua khong gian cu KHONG duoc hien
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải');
    expect(screen.queryByText('Trọng số của nhóm')).not.toBeInTheDocument();
    mocks.fetchAssignWeights.mockResolvedValueOnce(weightsView({ workspaceId: 'w3', weights: { experience: 0.6, reliability: 0.2, availability: 0.1, declared: 0.1 } }));
    rerender(<AssignWeightsPanel workspaceId="w3" canManage />);
    await waitFor(() => expect(sliderValues()).toEqual(['60', '20', '10', '10']));
    // Yêu cầu của w2 về muộn -> không ghi đè
    await act(async () => resolveOld(weightsView({ workspaceId: 'w2', weights: { experience: 0.1, reliability: 0.1, availability: 0.4, declared: 0.4 } })));
    expect(sliderValues()).toEqual(['60', '20', '10', '10']);
  });

  it('trọng số đã HỌC (lẻ) hiện làm tròn phần trăm nguyên, tổng 100', async () => {
    await setup({ view: weightsView({ weights: { experience: 0.306, reliability: 0.2445, availability: 0.253, declared: 0.1965 }, custom: true }) });
    expect(sliderValues()).toEqual(['31', '24', '25', '20']);
  });
});

describe('AssignWeightsPanel - chỉnh và lưu trọng số (OWNER / ADMIN)', () => {
  it('kéo một thanh -> BA thanh kia tự chia lại theo tỉ lệ, tổng luôn 100; kéo cả thanh Hồ sơ; chưa kéo thì Lưu bị khoá', async () => {
    await setup();
    const save = screen.getByRole('button', { name: 'Lưu trọng số' });
    expect(save).toBeDisabled();
    fireEvent.change(slider('Kinh nghiệm'), { target: { value: '60' } });
    expect(sliderValues()).toEqual(['60', '15', '13', '12']);
    expect(save).toBeEnabled();
    fireEvent.change(slider('Khả dụng'), { target: { value: '5' } });
    const v = sliderValues().map(Number);
    expect(v[2]).toBe(5);
    expect(v.reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.min(...v)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...v)).toBeLessThanOrEqual(70);
    fireEvent.change(slider('Hồ sơ'), { target: { value: '40' } });
    const h = sliderValues().map(Number);
    expect(h[3]).toBe(40);
    expect(h.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('Lưu -> saveAssignWeights(ws, số thực tổng 1); thành công -> thông báo, giá trị theo máy chủ, Lưu khoá lại', async () => {
    await setup();
    mocks.saveAssignWeights.mockResolvedValue(weightsView({ weights: { experience: 0.6, reliability: 0.15, availability: 0.13, declared: 0.12 }, custom: true, updatedAt: '2026-09-20T05:00:00.000Z' }));
    fireEvent.change(slider('Kinh nghiệm'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu trọng số' }));
    await waitFor(() => expect(mocks.saveAssignWeights).toHaveBeenCalledTimes(1));
    const [ws, body] = mocks.saveAssignWeights.mock.calls[0]!;
    expect(ws).toBe('w1');
    expect(body).toEqual({ experience: 0.6, reliability: 0.15, availability: 0.13, declared: 0.12 });
    expect(Math.abs(body.experience + body.reliability + body.availability + body.declared - 1)).toBeLessThan(1e-12);
    expect(await screen.findByText('Đã lưu trọng số.')).toBeInTheDocument();
    expect(sliderValues()).toEqual(['60', '15', '13', '12']);
    expect(screen.getByRole('button', { name: 'Lưu trọng số' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).not.toBeInTheDocument();
  });

  it('Lưu thất bại -> hiện thông điệp lỗi, giữ nguyên bản nháp để sửa lại', async () => {
    await setup();
    mocks.saveAssignWeights.mockRejectedValue(new Error('x'));
    fireEvent.change(slider('Kinh nghiệm'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu trọng số' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không lưu được trọng số.');
    expect(sliderValues()).toEqual(['60', '15', '13', '12']);
    expect(screen.getByRole('button', { name: 'Lưu trọng số' })).toBeEnabled();
  });

  it('"Hoàn tác" trả bản nháp về giá trị đã lưu và biến mất', async () => {
    await setup();
    fireEvent.change(slider('Khả dụng'), { target: { value: '50' } });
    expect(sliderValues()).not.toEqual(['36', '24', '20', '20']);
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(sliderValues()).toEqual(['36', '24', '20', '20']);
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).not.toBeInTheDocument();
    expect(mocks.saveAssignWeights).not.toHaveBeenCalled();
  });
});

describe('AssignWeightsPanel - đặt lại mặc định', () => {
  it('bấm -> hộp xác nhận (chưa gọi API); "Đặt lại" -> resetAssignWeights, hiện giá trị mới; "Huỷ" thì không gọi', async () => {
    await setup({ view: weightsView({ weights: { experience: 0.3, reliability: 0.3, availability: 0.2, declared: 0.2 }, custom: true, feedbackCount: 14 }) });
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mặc định' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Trọng số về 36% / 24% / 20% / 20% và số lượt phản hồi về 0');
    expect(dialog).toHaveTextContent('gom đủ 10 phản hồi');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.resetAssignWeights).not.toHaveBeenCalled();

    mocks.resetAssignWeights.mockResolvedValue(weightsView());
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mặc định' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đặt lại' }));
    await waitFor(() => expect(mocks.resetAssignWeights).toHaveBeenCalledWith('w1'));
    expect(await screen.findByText('Đã đặt lại 36% / 24% / 20% / 20% và bắt đầu đếm phản hồi từ đầu.')).toBeInTheDocument();
    expect(sliderValues()).toEqual(['36', '24', '20', '20']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Đã về mặc định và 0 phản hồi -> không còn gì để đặt lại
    expect(screen.getByRole('button', { name: 'Đặt lại mặc định' })).toBeDisabled();
  });

  it('nút bị khoá khi ĐÃ là mặc định và chưa có phản hồi; mở lại khi có phản hồi (dù trọng số mặc định)', async () => {
    await setup();
    expect(screen.getByRole('button', { name: 'Đặt lại mặc định' })).toBeDisabled();
    const utils = await setup({ view: weightsView({ feedbackCount: 3 }) });
    expect(within(utils.container).getByRole('button', { name: 'Đặt lại mặc định' })).toBeEnabled();
  });

  it('đặt lại thất bại -> lỗi, hộp xác nhận đóng', async () => {
    await setup({ view: weightsView({ custom: true, weights: { experience: 0.5, reliability: 0.3, availability: 0.1, declared: 0.1 } }) });
    mocks.resetAssignWeights.mockRejectedValue(new Error('x'));
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mặc định' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đặt lại' }));
    expect(await screen.findByText('Không đặt lại được trọng số.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('AssignWeightsPanel - thành viên thường (chỉ xem)', () => {
  it('thanh trượt bị khoá; không có nút Lưu / Hoàn tác / Đặt lại; có ghi chú; cấu hình CỦA MÌNH vẫn sửa được', async () => {
    await setup({ canManage: false });
    for (const n of SLIDERS) expect(slider(n)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Lưu trọng số' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đặt lại mặc định' })).not.toBeInTheDocument();
    expect(screen.getByText(/Chỉ chủ hoặc quản trị viên của không gian mới chỉnh được trọng số\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Số thẻ chồng lấn tối đa')).toBeEnabled();
    expect(sliderValues()).toEqual(['36', '24', '20', '20']);
  });
});

describe('AssignWeightsPanel - tự học, số liệu phản hồi, lịch sử', () => {
  it('chưa đủ lượt: nói còn bao nhiêu lượt; chưa có kết quả thì không hiện tỉ lệ', async () => {
    await setup({ view: weightsView({ feedbackCount: 3 }) });
    expect(screen.getByText(/Bắt đầu tự học từ phản hồi thứ 10 \(còn 7 lượt\); trước đó chỉ ghi nhận\./)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText(/Giao đúng người xếp đầu/)).not.toBeInTheDocument();
  });

  it('đang tự học + tỉ lệ giao đúng người xếp đầu (9/12 = 75%)', async () => {
    await setup({ view: weightsView({ feedbackCount: 12, learning: { minFeedback: 10, eta: 0.05, active: true }, feedback: { decided: 12, accepted: 9 } }) });
    expect(screen.getByText(/Đang tự học: mỗi lần bạn giao cho người khác người xếp đầu/)).toBeInTheDocument();
    expect(screen.getByText(/bước 5%/)).toBeInTheDocument();
    expect(screen.getByText('9/12')).toBeInTheDocument();
    expect(screen.getByText(/\(75%\)/)).toBeInTheDocument();
  });

  it('lịch sử: nhãn Tự học / Chỉnh tay, bốn giá trị % (mốc cũ trước khi có Hồ sơ: ba giá trị, không bịa HS), số phản hồi', async () => {
    const { unmount } = await setup();
    expect(screen.queryByText('Lịch sử thay đổi trọng số')).not.toBeInTheDocument();
    unmount();
    await setup({
      view: weightsView({
        history: [
          { id: 'h2', at: '2026-09-20T05:00:00.000Z', weights: { experience: 0.4, reliability: 0.3, availability: 0.2, declared: 0.1 }, feedbackCount: 10, source: 'LEARNED', runId: 'r1' },
          { id: 'h1', at: '2026-09-19T05:00:00.000Z', weights: { experience: 0.5, reliability: 0.3, availability: 0.2, declared: null }, feedbackCount: 0, source: 'MANUAL', runId: null },
        ],
      }),
    });
    expect(screen.getByText('Lịch sử thay đổi trọng số')).toBeInTheDocument();
    // Nhãn phải đúng với TỪNG dòng (không chỉ "có cả hai nhãn đâu đó")
    const learned = within(screen.getByText('KN 40% · TC 30% · KD 20% · HS 10%').closest('li')!);
    expect(learned.getByText('Tự học')).toBeInTheDocument();
    expect(learned.queryByText('Chỉnh tay')).not.toBeInTheDocument();
    expect(learned.getByText('· phản hồi #10')).toBeInTheDocument();
    const manual = within(screen.getByText('KN 50% · TC 30% · KD 20%').closest('li')!);
    expect(manual.getByText('Chỉnh tay')).toBeInTheDocument();
    expect(manual.queryByText('Tự học')).not.toBeInTheDocument();
    expect(manual.getByText('· phản hồi #0')).toBeInTheDocument();
  });
});

describe('AssignWeightsPanel - yêu cầu cũ về muộn', () => {
  it('yêu cầu của không gian cũ LỖI về muộn sau khi đã đổi sang không gian mới: không đè thông báo lỗi lên nội dung mới', async () => {
    let rejectOld!: (e: Error) => void;
    mocks.fetchAssignWeights.mockReturnValueOnce(new Promise((_, rej) => (rejectOld = rej)));
    mocks.fetchAssignProfile.mockResolvedValue(profileView());
    const utils = render(<AssignWeightsPanel workspaceId="w2" canManage />);
    mocks.fetchAssignWeights.mockResolvedValueOnce(weightsView({ workspaceId: 'w3' }));
    utils.rerender(<AssignWeightsPanel workspaceId="w3" canManage />);
    await screen.findByText('Trọng số của nhóm');
    await act(async () => rejectOld(new Error('muộn')));
    expect(screen.getByText('Trọng số của nhóm')).toBeInTheDocument();
    expect(screen.queryByText(/Không tải được cấu hình/)).not.toBeInTheDocument();
  });
});

describe('AssignWeightsPanel - cấu hình làm việc của tôi', () => {
  const capInput = () => screen.getByLabelText('Số thẻ chồng lấn tối đa') as HTMLInputElement;
  const pauseInput = () => screen.getByLabelText('Tạm nghỉ đến hết ngày') as HTMLInputElement;
  const saveBtn = () => screen.getByRole('button', { name: 'Lưu cấu hình' });

  it('hiện giá trị hiện tại; chưa đổi thì Lưu khoá; đổi số thẻ -> saveAssignProfile(ws, { maxParallelCards, pausedUntil: null })', async () => {
    await setup();
    expect(capInput().value).toBe('5');
    expect(pauseInput().value).toBe('');
    expect(saveBtn()).toBeDisabled();

    mocks.saveAssignProfile.mockResolvedValue(profileView({ maxParallelCards: 3, isDefault: false, updatedAt: '2026-09-20T05:00:00.000Z' }));
    fireEvent.change(capInput(), { target: { value: '3' } });
    expect(saveBtn()).toBeEnabled();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mocks.saveAssignProfile).toHaveBeenCalledWith('w1', { maxParallelCards: 3, pausedUntil: null }));
    expect(await screen.findByText('Đã lưu cấu hình làm việc của bạn.')).toBeInTheDocument();
    expect(capInput().value).toBe('3');
    expect(saveBtn()).toBeDisabled();
  });

  it('chọn ngày tạm nghỉ -> gửi 23:59:59.999 cuối ngày đó THEO GIỜ ĐỊA PHƯƠNG (ISO có Z); "Bỏ tạm nghỉ" -> null', async () => {
    await setup();
    mocks.saveAssignProfile.mockResolvedValue(profileView({ pausedUntil: endOfLocalDayIso('2027-03-10') }));
    fireEvent.change(pauseInput(), { target: { value: '2027-03-10' } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mocks.saveAssignProfile).toHaveBeenCalledTimes(1));
    const sent = mocks.saveAssignProfile.mock.calls[0]![1] as { maxParallelCards: number; pausedUntil: string };
    expect(sent.maxParallelCards).toBe(5);
    expect(sent.pausedUntil).toBe(endOfLocalDayIso('2027-03-10'));
    expect(sent.pausedUntil).toMatch(/Z$/);
    expect(pauseInput().value).toBe('2027-03-10');

    mocks.saveAssignProfile.mockResolvedValue(profileView());
    fireEvent.click(await screen.findByRole('button', { name: 'Bỏ tạm nghỉ' }));
    expect(pauseInput().value).toBe('');
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mocks.saveAssignProfile).toHaveBeenLastCalledWith('w1', { maxParallelCards: 5, pausedUntil: null }));
  });

  it('đang tạm nghỉ (ngày ở tương lai) -> hiện dải cảnh báo kèm ngày; đã qua ngày thì không hiện', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000);
    await setup({ profile: profileView({ pausedUntil: future.toISOString(), isDefault: false }) });
    expect(screen.getByText(/Bạn đang được đánh dấu tạm nghỉ đến hết ngày \d{2}\/\d{2}\/\d{4}/)).toBeInTheDocument();
    expect(pauseInput().value).not.toBe('');
  });

  it('đã hết hạn tạm nghỉ (ngày trong quá khứ) -> không có dải cảnh báo', async () => {
    await setup({ profile: profileView({ pausedUntil: new Date(Date.now() - 5 * 86_400_000).toISOString(), isDefault: false }) });
    expect(screen.queryByText(/Bạn đang được đánh dấu tạm nghỉ/)).not.toBeInTheDocument();
  });

  it('số thẻ không hợp lệ (0, 31, lẻ, rỗng) -> báo lỗi và KHOÁ Lưu; hợp lệ lại thì mở', async () => {
    await setup();
    for (const bad of ['0', '31', '2.5', '', '-1']) {
      fireEvent.change(capInput(), { target: { value: bad } });
      expect(saveBtn(), JSON.stringify(bad)).toBeDisabled();
      expect(screen.getByText(/Số thẻ chồng lấn tối đa phải là số nguyên từ 1 đến 30\./), JSON.stringify(bad)).toBeInTheDocument();
    }
    fireEvent.change(capInput(), { target: { value: '30' } });
    expect(saveBtn()).toBeEnabled();
    expect(screen.queryByText(/phải là số nguyên từ 1 đến 30/)).not.toBeInTheDocument();
    fireEvent.change(capInput(), { target: { value: '1' } });
    expect(saveBtn()).toBeEnabled();
  });

  it('lưu cấu hình thất bại -> lỗi, giữ nguyên bản nháp', async () => {
    await setup();
    mocks.saveAssignProfile.mockRejectedValue(new Error('x'));
    fireEvent.change(capInput(), { target: { value: '7' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText('Không lưu được cấu hình làm việc.')).toBeInTheDocument();
    expect(capInput().value).toBe('7');
    expect(saveBtn()).toBeEnabled();
  });
});
