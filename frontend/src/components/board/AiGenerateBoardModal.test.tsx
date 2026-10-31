import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardPlan, ExtractedDocument, GeneratePlanResult } from '../../types/ai';
import type { Board } from '../../types/board';
import AiGenerateBoardModal from './AiGenerateBoardModal';

// mock TRUOC khi import component: lop goi API va context khong gian lam viec
const mocks = vi.hoisted(() => ({
  fetchAiStatus: vi.fn(),
  extractDocument: vi.fn(),
  generateBoardPlan: vi.fn(),
  applyBoardPlan: vi.fn(),
  ctx: {
    workspaces: [] as Array<{ id: string; name: string }>,
    currentWorkspaceId: null as string | null,
  },
}));
vi.mock('../../lib/api/ai', () => ({
  fetchAiStatus: mocks.fetchAiStatus,
  extractDocument: mocks.extractDocument,
  generateBoardPlan: mocks.generateBoardPlan,
  applyBoardPlan: mocks.applyBoardPlan,
}));
vi.mock('../../context/WorkspacesContext', () => ({ useWorkspaces: () => mocks.ctx }));

// ===================== Du lieu thu =====================

const PLAN: BoardPlan = {
  mode: 'STRUCTURED',
  board: { name: 'Kế hoạch Marketing', color: '#519839' },
  labels: [{ key: 'l1', name: 'Quảng cáo', color: '#4bce97' }],
  lists: [
    {
      name: 'Chuẩn bị',
      cards: [
        {
          ref: 'c1',
          title: 'Chốt thông điệp',
          description: 'Mô tả của AI',
          sourceLine: 3,
          selected: true,
          startDate: null,
          startOrigin: 'NONE',
          dueDate: '2026-10-20',
          dueOrigin: 'EXPLICIT',
          labelKeys: ['l1'],
          checklist: ['Soạn', 'Duyệt'],
        },
        {
          ref: 'c2',
          title: 'Thiết kế bộ nhận diện',
          description: '',
          sourceLine: 4,
          selected: true,
          startDate: '2026-09-14',
          startOrigin: 'SCHEDULED',
          dueDate: '2026-09-16',
          dueOrigin: 'SCHEDULED',
          labelKeys: [],
          checklist: [],
        },
      ],
    },
    {
      name: 'Triển khai',
      cards: [
        {
          ref: 'c3',
          title: 'Nguyễn Minh Anh',
          description: '',
          sourceLine: null,
          selected: false,
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
  warnings: [
    { code: 'LLM_UNAVAILABLE', message: 'Kế hoạch được tạo bằng bộ luật, chưa dùng AI.' },
    { code: 'YEAR_INFERRED', message: 'Ngày chưa ghi năm, đã chọn năm gần nhất.', ref: 'c1', line: 3 },
  ],
  assumptions: ['Ngày hôm nay được tính là 14/09/2026.'],
};

const RESULT: GeneratePlanResult = {
  runId: 'run-1',
  llmUsed: false,
  modeAuto: 'STRUCTURED',
  plan: PLAN,
  stats: { totalCards: 3, selectedCards: 2, truncatedCards: 0, explicitCards: 1, scheduledCards: 1, undatedCards: 1 },
};

const BOARD = { id: 'board-1', name: 'Kế hoạch Marketing' } as Board;
const TEXT = '- Chốt thông điệp, hạn 20/10\n- Thiết kế bộ nhận diện';

const apiError = (message: string, errors?: Array<{ field: string; message: string }>) =>
  Object.assign(new Error(message), { isAxiosError: true, response: { status: 400, data: { success: false, message, errors } } });

/** Promise treo den khi goi resolve/reject (mo phong yeu cau dang chay). */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.fetchAiStatus.mockResolvedValue({ llmAvailable: false, provider: 'openai-compatible', model: '' });
  mocks.generateBoardPlan.mockResolvedValue(RESULT);
  mocks.applyBoardPlan.mockResolvedValue(BOARD);
  mocks.ctx.workspaces = [
    { id: 'ws1', name: 'Cá nhân' },
    { id: 'ws2', name: 'Nhóm Marketing' },
    { id: 'ws3', name: 'Nhóm khác' },
  ];
  mocks.ctx.currentWorkspaceId = 'ws1';
});

function renderModal(props: Partial<ComponentProps<typeof AiGenerateBoardModal>> = {}, setup: Parameters<typeof userEvent.setup>[0] = {}) {
  const user = userEvent.setup(setup);
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const utils = render(<AiGenerateBoardModal onClose={onClose} onCreated={onCreated} {...props} />);
  return { user, onClose, onCreated, ...utils };
}

type User = ReturnType<typeof userEvent.setup>;
const textbox = () => screen.getByRole('textbox', { name: 'Mô tả công việc' });
const generateButton = () => screen.getByRole('button', { name: /Tạo kế hoạch|Đang phân tích\.\.\./ });

async function fillText(user: User, text = TEXT) {
  await user.click(textbox());
  await user.paste(text);
}
async function toPreview(user: User, result: GeneratePlanResult = RESULT) {
  mocks.generateBoardPlan.mockResolvedValue(result);
  await fillText(user);
  await user.click(generateButton());
  await screen.findByRole('heading', { name: 'Xem trước kế hoạch' });
}
const card = (ref: string) => within(screen.getByTestId(`plan-card-${ref}`));
const applyButton = () => screen.getByRole('button', { name: /Tạo bảng \(\d+ thẻ\)|Đang tạo bảng\.\.\./ });
const backdrop = () => screen.getByRole('dialog').parentElement as HTMLElement;

// ===================== Man 1: nhap =====================

describe('AiGenerateBoardModal - màn nhập', () => {
  it('huy hiệu theo /status (không AI / có AI / lỗi); nút "Tạo kế hoạch" chỉ bật khi đủ 20 ký tự; bộ đếm; khoảng ngày sai chặn nút', async () => {
    const { user, unmount } = renderModal();
    expect(await screen.findByText(/Chưa bật AI/)).toBeInTheDocument();

    expect(generateButton()).toBeDisabled();
    await fillText(user, 'x'.repeat(19));
    expect(generateButton()).toBeDisabled();
    expect(screen.getByText('Cần ít nhất 20 ký tự')).toBeInTheDocument();
    expect(screen.getByLabelText('Số ký tự')).toHaveTextContent('19/20000');
    await user.type(textbox(), 'y');
    expect(generateButton()).toBeEnabled();
    expect(screen.getByLabelText('Số ký tự')).toHaveTextContent('20/20000');
    expect(screen.queryByText('Cần ít nhất 20 ký tự')).not.toBeInTheDocument();

    // khoảng trắng đầu/cuối không được tính: 20 khoảng trắng + 5 chữ vẫn thiếu
    await user.clear(textbox());
    await user.click(textbox());
    await user.paste(`${' '.repeat(20)}abcde`);
    expect(generateButton()).toBeDisabled();
    await user.clear(textbox());
    await fillText(user, 'z'.repeat(25));
    expect(generateButton()).toBeEnabled();

    // ngày bắt đầu sau ngày kết thúc: báo lỗi + chặn nút; sửa lại thì bật
    await user.click(screen.getByText('Tuỳ chọn'));
    fireEvent.change(screen.getByLabelText('Ngày bắt đầu dự án'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('Ngày kết thúc dự án'), { target: { value: '2026-11-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Ngày bắt đầu phải trước ngày kết thúc.');
    expect(generateButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Ngày kết thúc dự án'), { target: { value: '2026-12-31' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(generateButton()).toBeEnabled();
    unmount();

    // có AI
    mocks.fetchAiStatus.mockResolvedValue({ llmAvailable: true, provider: 'google-gemini', model: 'gemini-3.8-flash' });
    renderModal();
    expect(await screen.findByText('AI đang bật: google-gemini · gemini-3.8-flash')).toBeInTheDocument();
    expect(screen.queryByText(/Chưa bật AI/)).not.toBeInTheDocument();
  });

  it('/status lỗi: không có huy hiệu nhưng vẫn dùng được; modal nằm ngoài container (portal ra body)', async () => {
    mocks.fetchAiStatus.mockRejectedValue(new Error('mất mạng'));
    const { user, container } = renderModal();
    await waitFor(() => expect(mocks.fetchAiStatus).toHaveBeenCalled());
    expect(screen.queryByText(/Chưa bật AI|AI đang bật/)).not.toBeInTheDocument();
    await fillText(user);
    expect(generateButton()).toBeEnabled();

    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false); // portal: không nằm trong cây DOM của cha (popover có backdrop-blur/overflow)
    expect(document.body.contains(dialog)).toBe(true);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});

// ===================== Sinh ke hoach =====================

describe('AiGenerateBoardModal - sinh kế hoạch', () => {
  it('gửi đúng dữ liệu (không kèm khoá tuỳ chọn để trống; kèm khi có); hiện xem trước: bảng, danh sách, thẻ, nhãn, checklist, cảnh báo theo thẻ, nguồn kế hoạch', async () => {
    const { user } = renderModal();
    await fillText(user, `  ${TEXT}  \n`);
    await user.click(generateButton());
    await screen.findByRole('heading', { name: 'Xem trước kế hoạch' });

    // dữ liệu TỐI THIỂU: chữ đã cắt khoảng trắng đầu/cuối, không có mode/projectStart/projectEnd
    expect(mocks.generateBoardPlan).toHaveBeenCalledTimes(1);
    expect(mocks.generateBoardPlan).toHaveBeenLastCalledWith({ workspaceId: 'ws1', text: TEXT, inputKind: 'TEXT', skipWeekend: true });

    expect(screen.getByLabelText('Tên bảng')).toHaveValue('Kế hoạch Marketing');
    expect(screen.getAllByLabelText('Tên danh sách').map((i) => (i as HTMLInputElement).value)).toEqual(['Chuẩn bị', 'Triển khai']);
    expect(screen.getAllByLabelText('Tiêu đề thẻ').map((i) => (i as HTMLInputElement).value)).toEqual([
      'Chốt thông điệp',
      'Thiết kế bộ nhận diện',
      'Nguyễn Minh Anh',
    ]);
    expect(screen.getByText('Kế hoạch từ bộ luật (không dùng AI)')).toBeInTheDocument();
    expect(screen.getByText(/Chế độ: Có cấu trúc \(tự nhận diện\)/)).toBeInTheDocument();
    expect(screen.getByText('Đã chọn 2 thẻ')).toBeInTheDocument();

    // cảnh báo chung ở khung "Lưu ý"; cảnh báo của thẻ nằm TRONG thẻ đó; giả định có riêng
    expect(screen.getByText('Lưu ý (1)')).toBeInTheDocument();
    expect(card('c1').getByText(/Ngày chưa ghi năm/)).toBeInTheDocument();
    expect(card('c2').queryByText(/Ngày chưa ghi năm/)).not.toBeInTheDocument();
    expect(screen.getByText('Hệ thống đã giả định (1)')).toBeInTheDocument();

    // nhãn, checklist, mô tả, dòng nguồn / "AI thêm", nguồn ngày
    expect(card('c1').getByText('Quảng cáo')).toBeInTheDocument();
    expect(card('c1').getByText('Checklist: 2 mục')).toBeInTheDocument();
    expect(card('c1').getByText('Mô tả của AI')).toBeInTheDocument();
    expect(card('c1').getByText('Dòng 3')).toBeInTheDocument();
    expect(card('c3').getByText('AI thêm')).toBeInTheDocument();
    expect(card('c1').getByLabelText('Hạn chót')).toHaveValue('2026-10-20');
    expect(card('c1').getByLabelText('Ngày bắt đầu')).toHaveValue('');
    expect(card('c2').getByLabelText('Ngày bắt đầu')).toHaveValue('2026-09-14');
    // thẻ bỏ tick sẵn (mục Thành viên) hiện ở trạng thái chưa chọn
    expect(card('c3').getByRole('checkbox', { name: 'Chọn thẻ' })).not.toBeChecked();
    expect(card('c1').getByRole('checkbox', { name: 'Chọn thẻ' })).toBeChecked();
  });

  it('gửi kèm các tuỳ chọn khi có (cách đọc, khoảng ngày, bỏ T7/CN); AI dùng thì hiện "Kế hoạch do AI"; chế độ bị ghi đè hiện "(bạn đã chọn)"', async () => {
    const { user } = renderModal();
    await fillText(user);
    await user.click(screen.getByText('Tuỳ chọn'));
    await user.selectOptions(screen.getByLabelText('Cách đọc văn bản'), 'FREEFORM');
    fireEvent.change(screen.getByLabelText('Ngày bắt đầu dự án'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Ngày kết thúc dự án'), { target: { value: '2026-11-30' } });
    await user.click(screen.getByRole('checkbox', { name: 'Bỏ thứ Bảy, Chủ nhật khi xếp lịch' }));

    mocks.generateBoardPlan.mockResolvedValue({ ...RESULT, llmUsed: true, plan: { ...PLAN, mode: 'FREEFORM' } });
    await user.click(generateButton());
    await screen.findByRole('heading', { name: 'Xem trước kế hoạch' });

    expect(mocks.generateBoardPlan).toHaveBeenLastCalledWith({
      workspaceId: 'ws1',
      text: TEXT,
      inputKind: 'TEXT',
      mode: 'FREEFORM',
      projectStart: '2026-11-01',
      projectEnd: '2026-11-30',
      skipWeekend: false,
    });
    expect(screen.getByText('Kế hoạch do AI')).toBeInTheDocument();
    expect(screen.getByText(/Chế độ: Văn xuôi \(bạn đã chọn\)/)).toBeInTheDocument();
  });

  it('đang phân tích: nút khoá + thông báo; lỗi (429/400) KHÔNG đóng modal, KHÔNG mất chữ đã nhập; thông điệp cụ thể của trường ưu tiên; thử lại được', async () => {
    const pending = deferred<GeneratePlanResult>();
    mocks.generateBoardPlan.mockReturnValueOnce(pending.promise);
    const { user } = renderModal();
    await fillText(user);
    await user.click(generateButton());

    expect(generateButton()).toBeDisabled();
    expect(generateButton()).toHaveTextContent('Đang phân tích...');
    expect(screen.getByRole('status')).toHaveTextContent('có thể mất tới 30 giây');
    expect(screen.getByRole('button', { name: /Tải lên/ })).toBeDisabled(); // không tải tệp khác giữa chừng
    pending.reject(apiError('Ban thao tac qua nhieu, hay thu lai sau'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ban thao tac qua nhieu, hay thu lai sau');

    expect(textbox()).toHaveValue(TEXT); // giữ nguyên
    expect(screen.getByRole('heading', { name: 'Tạo bảng bằng AI' })).toBeInTheDocument(); // vẫn ở màn nhập
    expect(generateButton()).toBeEnabled();

    // lỗi kiểm tra đầu vào: hiện thông điệp của TRƯỜNG thay vì câu chung chung
    mocks.generateBoardPlan.mockRejectedValueOnce(apiError('Du lieu khong hop le', [{ field: 'text', message: 'Mo ta qua ngan (can it nhat 20 ky tu)' }]));
    await user.click(generateButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Mo ta qua ngan (can it nhat 20 ky tu)');

    // lỗi không phải của axios: câu dự phòng
    mocks.generateBoardPlan.mockRejectedValueOnce(new Error('boom'));
    await user.click(generateButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tạo được kế hoạch. Hãy thử lại.');

    // thử lại thành công: lỗi biến mất, sang xem trước
    await user.click(generateButton());
    await screen.findByRole('heading', { name: 'Xem trước kế hoạch' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.generateBoardPlan).toHaveBeenCalledTimes(4);
  });
});

// ===================== Tai tep =====================

describe('AiGenerateBoardModal - tải tệp .docx / .pdf', () => {
  const docx = (over: Partial<ExtractedDocument> = {}): ExtractedDocument => ({
    inputKind: 'DOCX',
    text: '# Kế hoạch\n- Việc một cần làm\n- Việc hai cần làm',
    chars: 47,
    truncated: false,
    pages: null,
    ...over,
  });
  const fileInput = () => screen.getByLabelText('Tệp báo cáo') as HTMLInputElement;

  const fileCard = (name: string) => screen.findByRole('group', { name: `Tệp đã chọn: ${name}` });

  it('chọn tệp: KHÔNG đổ chữ ra ô nhập mà hiện thẻ tệp; AI dùng thẳng chữ trong tệp + inputKind của tệp; "Bỏ tệp" quay lại chữ gõ tay (TEXT); PDF dài báo bị cắt kèm số trang', async () => {
    mocks.extractDocument.mockResolvedValueOnce(docx());
    const { user } = renderModal();
    await fillText(user, 'chữ gõ tay vẫn còn nguyên sau khi bỏ tệp');

    await user.upload(fileInput(), new File(['x'], 'ke-hoach.docx'));
    const card = await fileCard('ke-hoach.docx');
    expect(within(card).getByText(/đọc được 47 ký tự/)).toBeInTheDocument();
    expect(mocks.extractDocument).toHaveBeenCalledTimes(1);
    expect((mocks.extractDocument.mock.calls[0]![0] as File).name).toBe('ke-hoach.docx');
    // chữ trong tệp không hiện ra để sửa; ô nhập ẩn đi
    expect(screen.queryByRole('textbox', { name: 'Mô tả công việc' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Việc một cần làm');
    expect(screen.getByRole('button', { name: 'Chọn tệp khác' })).toBeInTheDocument();

    await user.click(generateButton());
    await screen.findByRole('heading', { name: 'Xem trước kế hoạch' });
    expect(mocks.generateBoardPlan).toHaveBeenLastCalledWith({ workspaceId: 'ws1', text: docx().text, inputKind: 'DOCX', skipWeekend: true });
    await user.click(screen.getByRole('button', { name: /Quay lại chỉnh mô tả/ }));

    // quay lại vẫn là tệp đó; "Bỏ tệp" -> về ô nhập với đúng chữ gõ tay lúc trước, nguồn TEXT
    await user.click(within(await fileCard('ke-hoach.docx')).getByRole('button', { name: 'Bỏ tệp' }));
    expect(textbox()).toHaveValue('chữ gõ tay vẫn còn nguyên sau khi bỏ tệp');
    await user.click(generateButton());
    await screen.findByRole('heading', { name: 'Xem trước kế hoạch' });
    expect(mocks.generateBoardPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'chữ gõ tay vẫn còn nguyên sau khi bỏ tệp', inputKind: 'TEXT' })
    );
    await user.click(screen.getByRole('button', { name: /Quay lại chỉnh mô tả/ }));

    // PDF bị cắt: có số trang + cảnh báo chỉ đọc phần đầu
    mocks.extractDocument.mockResolvedValueOnce(docx({ inputKind: 'PDF', truncated: true, pages: 60, chars: 20000 }));
    await user.upload(fileInput(), new File(['x'], 'bao-cao.pdf'));
    const pdf = await fileCard('bao-cao.pdf');
    expect(within(pdf).getByText(/60 trang · đọc được 20\.000 ký tự/)).toBeInTheDocument();
    expect(within(pdf).getByText('Tệp dài hơn giới hạn nên AI chỉ đọc phần đầu.')).toBeInTheDocument();
  });

  it('tệp có quá ít chữ: báo ngay trên thẻ tệp và khoá nút "Tạo kế hoạch"', async () => {
    mocks.extractDocument.mockResolvedValueOnce(docx({ text: 'Mục lục', chars: 7 }));
    const { user } = renderModal();
    await user.upload(fileInput(), new File(['x'], 'ngan.docx'));
    const card = await fileCard('ngan.docx');
    expect(within(card).getByText('Tệp có quá ít chữ (cần ít nhất 20 ký tự).')).toBeInTheDocument();
    expect(generateButton()).toBeDisabled();
  });

  it('tệp sai đuôi / quá 5MB bị chặn ngay ở trình duyệt (không gọi API); lỗi đọc tệp hiện thông điệp của server và KHÔNG mất chữ đang nhập', async () => {
    const { user } = renderModal({}, { applyAccept: false }); // để thử cả tệp trái thuộc tính accept
    await fillText(user);

    await user.upload(fileInput(), new File(['x'], 'ghi-chu.txt'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chỉ hỗ trợ tệp .docx hoặc .pdf.');
    await user.upload(fileInput(), new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], 'to.pdf'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tệp quá lớn (tối đa 5MB).');
    expect(mocks.extractDocument).not.toHaveBeenCalled();

    mocks.extractDocument.mockRejectedValueOnce(apiError('Tệp PDF bị khóa mật khẩu. Hãy gỡ mật khẩu rồi tải lại'));
    await user.upload(fileInput(), new File(['x'], 'khoa.pdf'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tệp PDF bị khóa mật khẩu');
    expect(textbox()).toHaveValue(TEXT);
    expect(screen.queryByRole('group', { name: /Tệp đã chọn/ })).not.toBeInTheDocument();

    // đang đọc tệp: ô nhập và nút tải khoá; đọc xong thì thẻ tệp thay ô nhập
    const pending = deferred<ExtractedDocument>();
    mocks.extractDocument.mockReturnValueOnce(pending.promise);
    await user.upload(fileInput(), new File(['x'], 'cham.docx'));
    expect(screen.getByRole('button', { name: 'Đang đọc tệp...' })).toBeDisabled();
    expect(textbox()).toBeDisabled();
    expect(generateButton()).toBeDisabled();
    pending.resolve(docx());
    expect(await fileCard('cham.docx')).toBeInTheDocument();
    expect(generateButton()).toBeEnabled();
  });
});

// ===================== Man 2: xem truoc, sua, tao bang =====================

describe('AiGenerateBoardModal - xem trước, sửa và tạo bảng', () => {
  it('sửa tick / tiêu đề / ngày / tên / màu: nút đếm đúng, dữ liệu gửi đi đúng từng trường (ngày sửa = "ghi rõ", xoá = "không có"), phần còn lại giữ NGUYÊN', async () => {
    const { user, onCreated } = renderModal();
    await toPreview(user);
    expect(applyButton()).toHaveTextContent('Tạo bảng (2 thẻ)');

    // bỏ tick thẻ c1 rồi tick lại c3 (Thành viên): 2 - 1 + 1
    await user.click(card('c1').getByRole('checkbox', { name: 'Chọn thẻ' }));
    expect(applyButton()).toHaveTextContent('Tạo bảng (1 thẻ)');
    expect(screen.getByText('Đã chọn 1 thẻ')).toBeInTheDocument(); // kế hoạch có 2 danh sách: số thẻ chọn KHÔNG phải số danh sách
    await user.click(card('c3').getByRole('checkbox', { name: 'Chọn thẻ' }));
    expect(applyButton()).toHaveTextContent('Tạo bảng (2 thẻ)');

    // c2: đổi tiêu đề, đổi ngày hạn (đang "Tự xếp"), xoá ngày bắt đầu
    const title = card('c2').getByLabelText('Tiêu đề thẻ');
    await user.clear(title);
    await user.type(title, 'Tiêu đề đã sửa');
    fireEvent.change(card('c2').getByLabelText('Hạn chót'), { target: { value: '2026-11-05' } });
    fireEvent.change(card('c2').getByLabelText('Ngày bắt đầu'), { target: { value: '' } });
    // c1 vốn ghi rõ hạn 20/10: nhãn "Ghi rõ"; c2 sau khi sửa cũng "Ghi rõ"
    expect(card('c1').getByText('Ghi rõ')).toBeInTheDocument();
    expect(card('c2').getByText('Ghi rõ')).toBeInTheDocument();
    expect(card('c2').queryByText('Tự xếp')).not.toBeInTheDocument();

    // tên bảng, tên danh sách, màu
    const boardName = screen.getByLabelText('Tên bảng');
    await user.clear(boardName);
    await user.type(boardName, 'Bảng đã đổi tên');
    const listName = screen.getAllByLabelText('Tên danh sách')[0]!;
    await user.clear(listName);
    await user.type(listName, 'Giai đoạn một');
    await user.click(screen.getByRole('button', { name: 'Màu bảng #0079BF' }));
    expect(screen.getByRole('button', { name: 'Màu bảng #0079BF' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(applyButton());
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    const [runId, sent] = mocks.applyBoardPlan.mock.calls[0]! as [string, BoardPlan];
    expect(runId).toBe('run-1');
    expect(sent.board).toEqual({ name: 'Bảng đã đổi tên', color: '#0079BF' });
    expect(sent.lists.map((l) => l.name)).toEqual(['Giai đoạn một', 'Triển khai']);
    expect(sent.lists[0]!.cards[0]).toEqual({ ...PLAN.lists[0]!.cards[0], selected: false });
    expect(sent.lists[0]!.cards[1]).toEqual({
      ...PLAN.lists[0]!.cards[1],
      title: 'Tiêu đề đã sửa',
      startDate: null,
      startOrigin: 'NONE',
      dueDate: '2026-11-05',
      dueOrigin: 'EXPLICIT',
    });
    expect(sent.lists[1]!.cards[0]).toEqual({ ...PLAN.lists[1]!.cards[0], selected: true });
    // các phần không sửa giữ NGUYÊN (gồm cảnh báo/giả định/nhãn: server dùng để tính editCount)
    expect(sent.warnings).toEqual(PLAN.warnings);
    expect(sent.assumptions).toEqual(PLAN.assumptions);
    expect(sent.labels).toEqual(PLAN.labels);
    expect(sent.mode).toBe('STRUCTURED');
    expect(onCreated).toHaveBeenCalledWith(BOARD);
  });

  it('lỗi chặn nút "Tạo bảng" kèm lời giải thích đúng chỗ: ngày bắt đầu sau hạn, tiêu đề/tên rỗng, không chọn thẻ nào; "Bỏ chọn hết"/"Chọn hết" theo danh sách', async () => {
    const { user } = renderModal();
    await toPreview(user);
    expect(applyButton()).toBeEnabled();

    // ngày bắt đầu sau hạn
    fireEvent.change(card('c2').getByLabelText('Ngày bắt đầu'), { target: { value: '2026-09-20' } });
    expect(card('c2').getByRole('alert')).toHaveTextContent('Ngày bắt đầu phải trước hạn chót.');
    expect(applyButton()).toBeDisabled();
    expect(screen.getByText(/Cần sửa 1 chỗ trước khi tạo bảng: Ngày bắt đầu phải trước hạn chót\./)).toBeInTheDocument();
    fireEvent.change(card('c2').getByLabelText('Ngày bắt đầu'), { target: { value: '2026-09-15' } });
    expect(applyButton()).toBeEnabled();

    // tiêu đề thẻ rỗng
    await user.clear(card('c1').getByLabelText('Tiêu đề thẻ'));
    expect(card('c1').getByRole('alert')).toHaveTextContent('Tiêu đề thẻ không được để trống.');
    expect(applyButton()).toBeDisabled();
    await user.type(card('c1').getByLabelText('Tiêu đề thẻ'), 'Đã có tiêu đề');
    expect(applyButton()).toBeEnabled();

    // tên bảng rỗng / tên danh sách rỗng
    await user.clear(screen.getByLabelText('Tên bảng'));
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Tên bảng không được để trống.');
    expect(applyButton()).toBeDisabled();
    await user.type(screen.getByLabelText('Tên bảng'), 'Bảng');
    await user.clear(screen.getAllByLabelText('Tên danh sách')[0]!);
    expect(screen.getByText('Tên danh sách không được để trống.')).toBeInTheDocument();
    expect(applyButton()).toBeDisabled();
    await user.type(screen.getAllByLabelText('Tên danh sách')[0]!, 'Chuẩn bị');
    expect(applyButton()).toBeEnabled();

    // bỏ chọn hết danh sách đầu -> còn 0 thẻ đã chọn (c3 vốn bỏ tick): chặn
    const firstList = within(screen.getByRole('region', { name: 'Danh sách 1' }));
    await user.click(firstList.getByRole('button', { name: 'Bỏ chọn hết' }));
    expect(applyButton()).toBeDisabled();
    expect(applyButton()).toHaveTextContent('Tạo bảng (0 thẻ)');
    expect(screen.getByText(/Cần sửa 1 chỗ trước khi tạo bảng: Chưa chọn thẻ nào để tạo\./)).toBeInTheDocument();
    await user.click(firstList.getByRole('button', { name: 'Chọn hết' }));
    expect(applyButton()).toBeEnabled();
    expect(applyButton()).toHaveTextContent('Tạo bảng (2 thẻ)');
    expect(mocks.applyBoardPlan).not.toHaveBeenCalled();
  });

  it('tạo bảng thất bại: KHÔNG đóng modal, giữ nguyên chỉnh sửa, nút bật lại; thử lại thành công', async () => {
    mocks.applyBoardPlan.mockRejectedValueOnce(apiError('Ke hoach nay da duoc ap dung'));
    const { user, onCreated, onClose } = renderModal();
    await toPreview(user);
    const title = card('c1').getByLabelText('Tiêu đề thẻ');
    await user.clear(title);
    await user.type(title, 'Bản sửa của tôi');

    await user.click(applyButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Ke hoach nay da duoc ap dung');
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(card('c1').getByLabelText('Tiêu đề thẻ')).toHaveValue('Bản sửa của tôi'); // chỉnh sửa còn nguyên
    expect(applyButton()).toBeEnabled();

    await user.click(applyButton());
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mocks.applyBoardPlan).toHaveBeenCalledTimes(2);
    expect(((mocks.applyBoardPlan.mock.calls[1]![1] as BoardPlan).lists[0]!.cards[0]!).title).toBe('Bản sửa của tôi');
  });

  it('bấm "Tạo bảng" hai lần thật nhanh: chỉ MỘT lần gọi API; trong lúc tạo, khoá đóng/quay lại/sửa; Esc và bấm nền bị bỏ qua', async () => {
    const pending = deferred<Board>();
    mocks.applyBoardPlan.mockReturnValueOnce(pending.promise);
    const { user, onCreated, onClose } = renderModal();
    await toPreview(user);

    // hai click CÙNG MỘT nhịp (giao diện chưa kịp vẽ lại nút thành "đang tạo"): chỉ cờ ref mới chặn được
    const button = applyButton();
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(mocks.applyBoardPlan).toHaveBeenCalledTimes(1);
    // rồi bấm đúp kiểu người dùng thật trên nút đã khoá: vẫn một lần
    await user.dblClick(applyButton());
    expect(mocks.applyBoardPlan).toHaveBeenCalledTimes(1);
    expect(applyButton()).toHaveTextContent('Đang tạo bảng...');
    expect(applyButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Quay lại chỉnh mô tả/ })).toBeDisabled();
    expect(card('c1').getByLabelText('Tiêu đề thẻ')).toBeDisabled();

    await user.keyboard('{Escape}');
    await user.click(backdrop());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('Bỏ kế hoạch này?')).not.toBeInTheDocument();

    pending.resolve(BOARD);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mocks.applyBoardPlan).toHaveBeenCalledTimes(1);
  });
});

// ===================== Dong modal / quay lai =====================

describe('AiGenerateBoardModal - đóng modal và quay lại', () => {
  it('màn nhập: bấm nền / Esc / nút Huỷ / dấu X đóng ngay; bấm bên trong hộp thoại thì KHÔNG đóng', async () => {
    const { user, onClose } = renderModal();
    await user.click(screen.getByRole('heading', { name: 'Tạo bảng bằng AI' }));
    await user.click(textbox());
    expect(onClose).not.toHaveBeenCalled();

    await user.click(backdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onClose).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('màn xem trước: đóng thì HỎI xác nhận (Esc chỉ đóng hộp xác nhận, không đóng modal); "Tiếp tục chỉnh" giữ nguyên; "Bỏ kế hoạch" mới đóng', async () => {
    const { user, onClose } = renderModal();
    await toPreview(user);

    await user.click(backdrop());
    expect(screen.getByText('Bỏ kế hoạch này?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Tiếp tục chỉnh' }));
    expect(screen.queryByText('Bỏ kế hoạch này?')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Xem trước kế hoạch' })).toBeInTheDocument();

    // Esc khi đang có hộp xác nhận: chỉ đóng hộp xác nhận, KHÔNG mở lại, KHÔNG đóng modal
    await user.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.getByText('Bỏ kế hoạch này?')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Bỏ kế hoạch này?')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Xem trước kế hoạch' })).toBeInTheDocument();

    // Esc thẳng trên màn xem trước: hỏi xác nhận
    await user.keyboard('{Escape}');
    expect(screen.getByText('Bỏ kế hoạch này?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bỏ kế hoạch' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('đang phân tích mà đóng: hỏi xác nhận với lời giải thích riêng; "Quay lại chỉnh mô tả": chưa sửa gì thì về ngay (giữ chữ), đã sửa thì hỏi', async () => {
    const pending = deferred<GeneratePlanResult>();
    mocks.generateBoardPlan.mockReturnValueOnce(pending.promise);
    const { user, onClose } = renderModal();
    await fillText(user);
    await user.click(generateButton());
    await user.click(backdrop());
    expect(screen.getByText('Hệ thống đang phân tích mô tả. Đóng lúc này sẽ bỏ kết quả.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tiếp tục chỉnh' }));
    expect(onClose).not.toHaveBeenCalled();
    pending.resolve(RESULT);
    await screen.findByRole('heading', { name: 'Xem trước kế hoạch' });

    // chưa sửa gì: về ngay, chữ còn nguyên
    await user.click(screen.getByRole('button', { name: /Quay lại chỉnh mô tả/ }));
    expect(screen.getByRole('heading', { name: 'Tạo bảng bằng AI' })).toBeInTheDocument();
    expect(textbox()).toHaveValue(TEXT);

    // sinh lại, sửa 1 chỗ: quay lại phải hỏi
    await user.click(generateButton());
    await screen.findByRole('heading', { name: 'Xem trước kế hoạch' });
    await user.click(card('c1').getByRole('checkbox', { name: 'Chọn thẻ' }));
    await user.click(screen.getByRole('button', { name: /Quay lại chỉnh mô tả/ }));
    expect(screen.getByText('Quay lại và bỏ các chỉnh sửa?')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Xem trước kế hoạch' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tiếp tục chỉnh' }));
    await user.click(screen.getByRole('button', { name: /Quay lại chỉnh mô tả/ }));
    await user.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(screen.getByRole('heading', { name: 'Tạo bảng bằng AI' })).toBeInTheDocument();
    expect(textbox()).toHaveValue(TEXT);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ===================== Khong gian lam viec =====================

describe('AiGenerateBoardModal - không gian làm việc', () => {
  it('mặc định theo không gian hiện tại; chọn khác thì gửi đúng; đổi không gian ở NƠI KHÁC giữa chừng KHÔNG đổi lựa chọn và KHÔNG đóng modal', async () => {
    const { user, onClose, rerender, onCreated } = renderModal();
    const select = () => screen.getByLabelText('Không gian làm việc') as HTMLSelectElement;
    expect(select().value).toBe('ws1');
    expect(Array.from(select().options).map((o) => o.textContent)).toEqual(['Cá nhân', 'Nhóm Marketing', 'Nhóm khác']);

    await user.selectOptions(select(), 'ws2');
    await fillText(user);

    // không gian hiện tại của ứng dụng đổi sang ws3: modal giữ ws2
    mocks.ctx.currentWorkspaceId = 'ws3';
    rerender(<AiGenerateBoardModal onClose={onClose} onCreated={onCreated} />);
    expect(select().value).toBe('ws2');
    expect(onClose).not.toHaveBeenCalled();
    expect(textbox()).toHaveValue(TEXT); // chữ đã nhập còn nguyên

    await user.click(generateButton());
    await screen.findByRole('heading', { name: 'Xem trước kế hoạch' });
    expect(mocks.generateBoardPlan).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'ws2' }));
  });

  it('khoá theo không gian của trang (không có ô chọn, hiện tên, gửi đúng id); context tải chậm thì mở ra rồi mới có mặc định; chưa có không gian nào thì chưa tạo được', async () => {
    const forced = renderModal({ workspaceId: 'ws2' });
    expect(screen.queryByLabelText('Không gian làm việc')).not.toBeInTheDocument();
    expect(screen.getByText('Nhóm Marketing')).toBeInTheDocument();
    await fillText(forced.user);
    await forced.user.click(generateButton());
    await screen.findByRole('heading', { name: 'Xem trước kế hoạch' });
    expect(mocks.generateBoardPlan).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'ws2' }));
    forced.unmount();

    // context chưa tải xong lúc mở modal
    mocks.ctx.workspaces = [];
    mocks.ctx.currentWorkspaceId = null;
    const late = renderModal();
    expect(screen.getByRole('option', { name: 'Đang tải...' })).toBeInTheDocument();
    await fillText(late.user);
    expect(generateButton()).toBeDisabled(); // chưa có không gian nào để gắn kế hoạch

    mocks.ctx.workspaces = [{ id: 'ws9', name: 'Vừa tải xong' }];
    mocks.ctx.currentWorkspaceId = 'ws9';
    late.rerender(<AiGenerateBoardModal onClose={late.onClose} onCreated={late.onCreated} />);
    expect((screen.getByLabelText('Không gian làm việc') as HTMLSelectElement).value).toBe('ws9');
    expect(generateButton()).toBeEnabled();
    expect(textbox()).toHaveValue(TEXT);
  });
});
