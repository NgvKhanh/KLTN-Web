import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type AxiosResponse } from 'axios';
import { useEffect } from 'react';
import { MemoryRouter, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantProvider } from '../../context/AssistantContext';
import { QUICK_QUESTIONS } from '../../lib/chatText';
import type { ChatActionPlan, ChatActionResult, ChatAnswer, ChatCard, ChatConversationHistory, ChatConversationSummary, ChatReply, ChatUnderstood } from '../../types/chat';
import type { ChatV2Block } from '../../types/chat';
import AssistantButton from './AssistantButton';
import AssistantPanel from './AssistantPanel';

// Tich hop giao dien tro ly (CHATBOT_MODULE.md §13): API bi mock (lib/api/chat co test rieng).

const mocks = vi.hoisted(() => ({
  fetchChatStatus: vi.fn(),
  sendChatMessage: vi.fn(),
  sendChatChoice: vi.fn(),
  fetchMoreAnswer: vi.fn(),
  fetchChatConversations: vi.fn(),
  fetchChatConversation: vi.fn(),
  confirmChatAction: vi.fn(),
  cancelChatAction: vi.fn(),
  uploadChatFile: vi.fn(),
  discardChatUpload: vi.fn(),
}));
vi.mock('../../lib/api/chat', () => mocks);

const GENERATED = '2026-09-30T03:05:00.000Z'; // 10:05 gio VN

function v2Block(id: string, title: string, ids: string[], page = 1, hasMore = false): ChatV2Block {
  return { id, title, status: 'OK', tool: 'query_tasks', pagination: { page, hasMore },
    source: { id: `source-${id}`, generatedAt: GENERATED, scope: { kind: 'BOARD', boardId: 'b1' }, scopeLabel: '1234', appliedInput: { filters: { completion: 'ALL' } }, ranges: [] },
    data: { total: hasMore ? 3 : ids.length, page, pageSize: 2, hasMore, cards: ids.map((id) => ({ id, title: `Việc ${id}`, status: 'TODO', isDone: false, boardId: 'b1', boardName: '1234', columnId: 'l1', columnName: 'Cần làm', dueDate: null, completedAt: null, createdAt: GENERATED, overdue: false, assignees: [] })) },
  };
}

function card(id: string, over: Partial<ChatCard> = {}): ChatCard {
  return {
    id,
    title: `Việc ${id}`,
    boardId: 'b1',
    boardName: 'Bảng Marketing',
    listName: 'Đang làm',
    status: 'IN_PROGRESS',
    dueDate: '2026-09-30T10:00:00.000Z', // 17:00 gio VN
    completedAt: null,
    overdue: false,
    checklistDone: 1,
    checklistTotal: 3,
    assignees: ['Trần Lan'],
    ...over,
  };
}

function answer(over: Partial<ChatAnswer> = {}): ChatAnswer {
  return {
    kind: 'ANSWER',
    text: 'Bạn có 12 việc sắp đến hạn trong 7 ngày tới.',
    scopeLabel: 'Tính trên 3 bảng bạn xem được.',
    generatedAt: GENERATED,
    facts: [
      { key: 'total', label: 'Tổng số', value: 12 },
      { key: 'overdue', label: 'Quá hạn', value: 1 },
    ],
    cards: Array.from({ length: 10 }, (_, i) => card(`c${i + 1}`)),
    total: 12,
    page: 1,
    pageSize: 10,
    sections: [],
    ignoredSlots: [],
    notes: ['Chưa tính các mục checklist được giao riêng cho từng người.'],
    suggestions: ['Hôm nay tôi nên xử lý gì trước?'],
    ...over,
  };
}

function reply(over: Partial<ChatAnswer> = {}, understood: Partial<ChatUnderstood> = {}, cid = 'conv-1'): ChatReply {
  return {
    conversationId: cid,
    understood: { intent: 'MY_TASKS', period: 'NEXT_7_DAYS', focus: 'OPEN', memberName: null, parser: 'HYBRID', ...understood },
    answer: answer(over),
  };
}

const httpError = (status: number) =>
  new AxiosError('loi', 'ERR', undefined, undefined, { status, data: { success: false, message: 'Khong dau' } } as AxiosResponse);

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname + loc.search}</output>;
}

/** Cho test doi trang bang code (nhu menu bang / sidebar), khong qua lien ket trong cau tra loi. */
let goTo: (to: string) => void = () => undefined;
function NavProbe() {
  const navigate = useNavigate();
  useEffect(() => { goTo = navigate; }, [navigate]);
  return null;
}

/** Hai layout rieng, moi cai co nut Trợ lý rieng (Header bi dung lai khi doi layout nhu app that). */
function LayoutA() {
  return (
    <div data-testid="layout-main">
      <AssistantButton />
      <Outlet />
    </div>
  );
}
function LayoutB() {
  return (
    <div data-testid="layout-board">
      <AssistantButton />
      <Outlet />
    </div>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AssistantProvider>
        <Routes>
          <Route element={<LayoutA />}>
            <Route path="/home" element={<p>Trang chủ</p>} />
            <Route path="/workspaces/:workspaceId" element={<p>Trang không gian</p>} />
          </Route>
          <Route element={<LayoutB />}>
            <Route path="/boards/:boardId" element={<p>Trang bảng</p>} />
          </Route>
        </Routes>
        <AssistantPanel />
        <LocationProbe />
        <NavProbe />
      </AssistantProvider>
    </MemoryRouter>
  );
}

const panel = () => screen.getByRole('dialog', { name: 'Trợ lý công việc' });
const input = () => screen.getByRole('textbox', { name: 'Câu hỏi cho trợ lý' });
async function openPanel() {
  // act async: cho ca luot tai trang thai AI (goi khi mo panel) xong trong act
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Trợ lý' }));
  });
  return panel();
}
/** Bam mot nut gui yeu cau: cho cau tra loi (mock) ve trong act. */
async function clickAsync(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}
async function askQuestion(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  await clickAsync(screen.getByRole('button', { name: 'Gửi' }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'legacy' });
  mocks.fetchChatConversations.mockResolvedValue({ conversations: [], page: 1, hasMore: false });
});

describe('AssistantPanel: mo / dong', () => {
  it('chua mo thi khong render va KHONG goi API; mo -> hoi trang thai 1 lan; "Chế độ cơ bản" khi khong co AI', async () => {
    mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: false });
    renderAt('/home');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.fetchChatStatus).not.toHaveBeenCalled();

    const btn = screen.getByRole('button', { name: 'Trợ lý' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await openPanel();
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(await within(panel()).findByText('Chế độ cơ bản')).toBeInTheDocument();
    expect(within(panel()).getByText('AI có thể nhận câu hỏi, tên bảng/thành viên, tiêu đề, hạn, trạng thái và nhật ký liên quan mà bạn được phép xem.')).toBeInTheDocument();
    expect(input()).toHaveFocus();

    fireEvent.click(btn); // dong
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(btn); // mo lai: khong hoi trang thai lan nua
    expect(mocks.fetchChatStatus).toHaveBeenCalledTimes(1);
  });

  it('co AI -> khong co nhan "Chế độ cơ bản"; loi tai trang thai -> khong nhan, lan mo sau hoi lai', async () => {
    mocks.fetchChatStatus.mockRejectedValueOnce(new Error('mang')).mockResolvedValue({ llmAvailable: true });
    renderAt('/home');
    await openPanel();
    await waitFor(() => expect(mocks.fetchChatStatus).toHaveBeenCalledTimes(1));
    expect(within(panel()).queryByText('Chế độ cơ bản')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng trợ lý' }));
    await openPanel();
    await waitFor(() => expect(mocks.fetchChatStatus).toHaveBeenCalledTimes(2));
    expect(within(panel()).queryByText('Chế độ cơ bản')).not.toBeInTheDocument();
  });

  it('Esc khi con tro trong panel thi dong; Esc / bam o ngoai panel KHONG dong', async () => {
    renderAt('/home');
    await openPanel();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByText('Trang chủ'));
    fireEvent.click(screen.getByText('Trang chủ'));
    expect(panel()).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('co hop thoai modal khac de len panel (aria-modal) -> Esc la cua lop do, panel khong dong', async () => {
    renderAt('/home');
    await openPanel();
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    try {
      fireEvent.keyDown(input(), { key: 'Escape' });
      expect(panel()).toBeInTheDocument();
    } finally {
      modal.remove();
    }
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('AssistantPanel: pham vi', () => {
  it('pham vi THEO TRANG: trang chu / khong gian tim tren moi bang duoc phep (MY); trang bang khoa cung trong bang do (BOARD); giu hoi thoai cho cau noi tiep', async () => {
    mocks.sendChatMessage.mockResolvedValue(reply());
    const expected = { '/home': { kind: 'MY' }, '/workspaces/ws2': { kind: 'MY' }, '/boards/b1': { kind: 'BOARD', boardId: 'b1' } } as const;
    for (const [path, scope] of Object.entries(expected)) {
      const view = renderAt(path);
      await openPanel();
      expect(within(panel()).queryByRole('radio')).not.toBeInTheDocument();
      expect(within(panel()).queryByRole('combobox')).not.toBeInTheDocument();
      // nhan pham vi o tieu de panel noi ro dang lam viec trong dau
      expect(within(panel()).getByText(scope.kind === 'BOARD' ? 'Trong bảng đang mở' : 'Mọi bảng của bạn')).toBeInTheDocument();
      await askQuestion('Việc của tôi?');
      await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenLastCalledWith({ message: 'Việc của tôi?', scope, conversationId: undefined }));
      await askQuestion('còn tuần sau?');
      await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenLastCalledWith({ message: 'còn tuần sau?', scope, conversationId: 'conv-1' }));
      view.unmount();
    }
  });

  it('o trang bang: moi cau gui kem pham vi BOARD cua bang dang mo - backend khoa cung trong bang, ten bang khac trong cau khong mo rong duoc', async () => {
    mocks.sendChatMessage.mockResolvedValue(reply());
    renderAt('/boards/b1');
    await openPanel();
    await askQuestion('Trong bảng 1234 ai đang có nhiều việc nhất?');
    await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenCalledTimes(1));
    expect(mocks.sendChatMessage.mock.calls[0]![0]).toEqual({ message: 'Trong bảng 1234 ai đang có nhiều việc nhất?', scope: { kind: 'BOARD', boardId: 'b1' }, conversationId: undefined });
    await askQuestion('Còn trong không gian Nhóm A?');
    await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenCalledTimes(2));
    expect(mocks.sendChatMessage.mock.calls[1]![0]).toEqual({ message: 'Còn trong không gian Nhóm A?', scope: { kind: 'BOARD', boardId: 'b1' }, conversationId: 'conv-1' });
  });
});

describe('AssistantPanel: hoi - dap', () => {
  it('dang tra loi -> cau tra loi day du: dong "hiểu là", con so, the co lien ket + trang thai / han / checklist / nguoi nhan, ghi chu, pham vi + gio', async () => {
    let resolve!: (r: ChatReply) => void;
    mocks.sendChatMessage.mockReturnValue(new Promise<ChatReply>((r) => (resolve = r)));
    renderAt('/home');
    await openPanel();
    await askQuestion('  Việc nào của tôi sắp đến hạn?  ');
    expect(mocks.sendChatMessage).toHaveBeenCalledWith({ message: 'Việc nào của tôi sắp đến hạn?', scope: { kind: 'MY' }, conversationId: undefined });
    expect(input()).toHaveValue('');
    expect(within(panel()).getByRole('status')).toHaveTextContent('Đang tra cứu dữ liệu…');
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeDisabled();
    // dang cho tra loi: giu hoi thoai, go tiep duoc nhung chua gui duoc
    expect(within(panel()).getByRole('button', { name: 'Hội thoại mới' })).toBeDisabled();
    fireEvent.change(input(), { target: { value: 'Câu tiếp theo' } });
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeDisabled();

    const cards = Array.from({ length: 10 }, (_, i) => card(`c${i + 1}`));
    cards[1] = card('c2', { overdue: true, reason: 'OVERDUE', dueDate: '2026-09-28T02:00:00.000Z' });
    cards[2] = card('c3', { checklistTotal: 0, checklistDone: 0, assignees: [], dueDate: null, reason: 'DUE_TODAY' });
    await act(async () => resolve(reply({ cards })));
    const p = panel();
    expect(within(p).getByText('Việc nào của tôi sắp đến hạn?')).toBeInTheDocument();
    expect(p).toHaveTextContent('Trợ lý hiểu là: việc của bạn · chưa xong · 7 ngày tới · hiểu bằng AI + bộ luật');
    expect(within(p).getByText('Tổng số').nextSibling).toHaveTextContent('12');
    const list = within(p).getByRole('list', { name: 'Danh sách việc' });
    expect(within(list).getAllByRole('link')).toHaveLength(10);
    const first = within(list).getByRole('link', { name: /Việc c1\b/ });
    expect(first).toHaveAttribute('href', '/boards/b1?card=c1');
    expect(first).toHaveTextContent('Đang làm'); // trang thai (StatusBadge) + ten danh sach
    expect(first).toHaveTextContent('Hạn 30/09 17:00');
    expect(first).toHaveTextContent('Checklist 1/3');
    expect(first).toHaveTextContent('Trần Lan');
    expect(first).not.toHaveTextContent('Quá hạn');
    const late = within(list).getByRole('link', { name: /Việc c2\b/ });
    expect(late).toHaveTextContent('Quá hạn · 28/09 09:00');
    expect(late).not.toHaveTextContent('Hạn 28/09');
    const bare = within(list).getByRole('link', { name: /Việc c3\b/ });
    expect(bare).toHaveTextContent('Hạn hôm nay'); // nhan ly do (cau hoi uu tien)
    expect(bare).not.toHaveTextContent('Checklist');
    expect(bare).not.toHaveTextContent('Trần Lan');
    expect(bare.textContent).not.toMatch(/Hạn \d/);
    expect(within(p).getByText('Chưa tính các mục checklist được giao riêng cho từng người.')).toBeInTheDocument();
    expect(within(p).getByText('Tính trên 3 bảng bạn xem được. Lúc 10:05.')).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: 'Xem thêm (còn 2 việc)' })).toBeEnabled();
  });

  it('Enter gui, Shift+Enter khong gui, cau rong khong gui; cau thu hai gui kem ma hoi thoai; goi y + cau hoi nhanh gui dung chu', async () => {
    const user = userEvent.setup();
    mocks.sendChatMessage.mockResolvedValue(reply());
    renderAt('/home');
    await openPanel();
    // cau hoi nhanh (hoi thoai rong)
    await user.click(within(panel()).getByRole('button', { name: 'Ai đang có nhiều việc?' }));
    await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenCalledTimes(1));
    expect(mocks.sendChatMessage.mock.calls[0]![0]).toEqual({ message: 'Ai đang có nhiều việc?', scope: { kind: 'MY' }, conversationId: undefined });
    await within(panel()).findByText('Bạn có 12 việc sắp đến hạn trong 7 ngày tới.');

    await user.type(input(), '   ');
    await user.keyboard('{Enter}');
    expect(input()).toHaveValue('   '); // khong gui -> khong xoa o nhap
    await user.type(input(), 'còn{Shift>}{Enter}{/Shift}tuần sau');
    // Enter luc bo go tieng Viet dang ghep chu (IME) -> khong gui
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    expect(mocks.sendChatMessage).toHaveBeenCalledTimes(1);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenCalledTimes(2));
    expect(mocks.sendChatMessage.mock.calls[1]![0]).toEqual({ message: 'còn\ntuần sau', scope: { kind: 'MY' }, conversationId: 'conv-1' });

    // goi y chi o luot moi nhat
    await waitFor(() => expect(within(panel()).getAllByRole('button', { name: 'Hôm nay tôi nên xử lý gì trước?' })).toHaveLength(1));
    await user.click(within(panel()).getByRole('button', { name: 'Hôm nay tôi nên xử lý gì trước?' }));
    await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenCalledTimes(3));
    expect(mocks.sendChatMessage.mock.calls[2]![0].message).toBe('Hôm nay tôi nên xử lý gì trước?');
    expect(input()).toHaveAttribute('maxLength', '500');
  });

  it('loi: 429 / 403 / mat mang -> thong diep tieng Viet co dau; hoi thoai khong mat, hoi tiep duoc', async () => {
    mocks.sendChatMessage
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(httpError(403))
      .mockRejectedValueOnce(new AxiosError('Network Error'))
      .mockResolvedValue(reply());
    renderAt('/home');
    await openPanel();
    await askQuestion('Câu một');
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('Bạn hỏi hơi nhiều trong thời gian ngắn. Hãy thử lại sau ít phút.');
    await askQuestion('Câu hai');
    await within(panel()).findByText('Bạn không có quyền xem phạm vi này. Hãy chọn phạm vi khác.');
    await askQuestion('Câu ba');
    await within(panel()).findByText('Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.');
    await askQuestion('Câu bốn');
    await within(panel()).findByText('Bạn có 12 việc sắp đến hạn trong 7 ngày tới.');
    expect(within(panel()).getAllByRole('alert')).toHaveLength(3);
  });

  it('ket qua rong + bang theo nguoi (truong nhom thay cot song song / tam nghi) + nhan xet AI o o rieng + hoi thoai moi phia server', async () => {
    mocks.sendChatMessage
      .mockResolvedValueOnce(reply({ text: 'Bạn không có việc nào quá hạn.', facts: [{ key: 'total', label: 'Tổng số', value: 0 }], cards: [], total: 0 }))
      .mockResolvedValueOnce({
        ...reply(
          {
            text: 'Số việc chưa xong của từng người (2 người).',
            cards: [],
            total: 0,
            rows: [
              { userId: 'u1', name: 'Trần Lan', open: 5, overdue: 2, capacity: 3, pausedUntil: '2026-10-05T00:00:00.000Z' },
              { userId: 'u2', name: 'Hoàng Minh', open: 1, overdue: 0, capacity: null, pausedUntil: null },
            ],
          },
          { intent: 'TEAM_WORKLOAD', period: null, focus: null }
        ),
        conversationReset: true,
      })
      .mockResolvedValueOnce(
        reply(
          {
            text: 'Tuần này, nhóm đã hoàn thành 3 việc.',
            cards: [],
            total: 0,
            sections: [{ key: 'OVERDUE', label: 'Quá hạn', total: 7, cards: [card('o1', { overdue: true }), card('o2', { overdue: true })] }],
            comment: { text: 'Nhóm có 2 việc quá hạn, nên xử lý sớm.', source: 'AI' },
          },
          { intent: 'TEAM_SUMMARY', period: 'THIS_WEEK', focus: null }
        )
      );
    renderAt('/home');
    await openPanel();
    await askQuestion('Việc nào quá hạn?');
    await within(panel()).findByText('Bạn không có việc nào quá hạn.');
    expect(within(panel()).queryByRole('list', { name: 'Danh sách việc' })).not.toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: /Xem thêm/ })).not.toBeInTheDocument();

    await askQuestion('Ai nhiều việc?');
    const table = await within(panel()).findByRole('table');
    expect(within(table).getAllByRole('row').map((r) => r.textContent)).toEqual([
      'Thành viênChưa xongQuá hạnSong song tối đaTạm nghỉ đến',
      'Trần Lan52305/10',
      'Hoàng Minh10mặc định—',
    ]);
    expect(within(panel()).getByRole('status')).toHaveTextContent('Hội thoại trước đã hết hạn');

    await askQuestion('Nhóm thế nào?');
    const box = await within(panel()).findByRole('complementary', { name: 'Nhận xét của trợ lý (AI)' });
    expect(box).toHaveTextContent('Nhóm có 2 việc quá hạn, nên xử lý sớm.');
    // danh sach phu (<= 5 the) + so con lai
    const section = within(panel()).getByRole('region', { name: 'Quá hạn' });
    expect(within(section).getByRole('heading')).toHaveTextContent('Quá hạn (7)');
    expect(within(section).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/boards/b1?card=o1', '/boards/b1?card=o2']);
    expect(within(section).getByText('và 5 việc khác.')).toBeInTheDocument();
    expect(within(panel()).queryByRole('status')).not.toBeInTheDocument(); // thong bao cu mat khi hoi cau moi
  });

  it('thanh vien khong thay cot quan ly (server khong gui truong do)', async () => {
    mocks.sendChatMessage.mockResolvedValue(
      reply({ cards: [], total: 0, rows: [{ userId: 'u1', name: 'Trần Lan', open: 5, overdue: 2 }] }, { intent: 'TEAM_WORKLOAD', period: null, focus: null })
    );
    renderAt('/home');
    await openPanel();
    await askQuestion('Ai nhiều việc?');
    const table = await within(panel()).findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Thành viên', 'Chưa xong', 'Quá hạn']);
  });
});

describe('AssistantPanel: hoi lai + xem them', () => {
  it('"Ý bạn là ai?" -> bam ten gui choice USER; lua chon cu khong bam duoc nua; hoi lai chon khong gian gui WORKSPACE', async () => {
    mocks.sendChatMessage
      .mockResolvedValueOnce(
        reply(
          { kind: 'CLARIFY', text: 'Có nhiều người khớp với “Lan”. Ý bạn là ai?', cards: [], total: 0, facts: [], suggestions: [], notes: [], clarify: { question: 'Ý bạn là ai?', options: [{ id: 'u1', label: 'Nguyễn Thị Lan', kind: 'USER' }, { id: 'u2', label: 'Trần Lan', kind: 'USER' }] } },
          { intent: 'MEMBER_TASKS', memberName: null }
        )
      )
      .mockResolvedValueOnce(
        reply(
          { kind: 'CLARIFY', text: 'Bạn muốn xem trong không gian nào?', cards: [], total: 0, facts: [], suggestions: [], notes: [], clarify: { question: 'Bạn muốn xem trong không gian nào?', options: [{ id: 'ws2', label: 'Nhóm A', kind: 'WORKSPACE' }] } },
          { intent: 'TEAM_SUMMARY' }
        )
      );
    mocks.sendChatChoice.mockResolvedValue(reply({ text: 'Trần Lan có 2 việc chưa xong.' }, { intent: 'MEMBER_TASKS', memberName: 'Trần Lan' }));
    renderAt('/home');
    await openPanel();
    await askQuestion('Lan đang làm gì?');
    const group = await within(panel()).findByRole('group', { name: 'Ý bạn là ai?' });
    await clickAsync(within(group).getByRole('button', { name: 'Trần Lan' }));
    expect(mocks.sendChatChoice).toHaveBeenCalledWith('conv-1', { id: 'u2', label: 'Trần Lan', kind: 'USER' });
    await within(panel()).findByText('Trần Lan có 2 việc chưa xong.');
    expect(within(panel()).getByText('Chọn: Trần Lan')).toBeInTheDocument();
    expect(panel()).toHaveTextContent('Trợ lý hiểu là: việc của Trần Lan · chưa xong');
    expect(within(group).getByRole('button', { name: 'Nguyễn Thị Lan' })).toBeDisabled(); // khong con la luot moi nhat

    await askQuestion('Nhóm thế nào?');
    const ws = await within(panel()).findByRole('group', { name: 'Bạn muốn xem trong không gian nào?' });
    await clickAsync(within(ws).getByRole('button', { name: 'Nhóm A' }));
    expect(mocks.sendChatChoice).toHaveBeenLastCalledWith('conv-1', { id: 'ws2', label: 'Nhóm A', kind: 'WORKSPACE' });
  });

  it('chon khi hoi thoai phia server da het han (404) -> "Hội thoại đã hết hạn", cau sau gui KHONG kem ma cu', async () => {
    mocks.sendChatMessage
      .mockResolvedValueOnce(
        reply(
          { kind: 'CLARIFY', text: 'Ý bạn là ai?', cards: [], total: 0, facts: [], suggestions: [], notes: [], clarify: { question: 'Ý bạn là ai?', options: [{ id: 'u2', label: 'Trần Lan', kind: 'USER' }] } },
          { intent: 'MEMBER_TASKS' }
        )
      )
      .mockResolvedValue(reply());
    mocks.sendChatChoice.mockRejectedValueOnce(httpError(404));
    renderAt('/home');
    await openPanel();
    await askQuestion('Lan đang làm gì?');
    await clickAsync(await within(panel()).findByRole('button', { name: 'Trần Lan' }));
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('Hội thoại đã hết hạn. Hãy hỏi lại câu hỏi.');
    await askQuestion('Lan đang làm gì?');
    await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenCalledTimes(2));
    expect(mocks.sendChatMessage.mock.calls[1]![0].conversationId).toBeUndefined();
  });

  it('"Xem thêm": goi trang 2, noi the (bo trung), het thi an nut; chi luot moi nhat co nut', async () => {
    mocks.sendChatMessage.mockResolvedValueOnce(reply()).mockResolvedValueOnce(reply({ text: 'Câu thứ hai.', cards: [card('x1')], total: 1 }));
    mocks.fetchMoreAnswer.mockResolvedValue(reply({ cards: [card('c10'), card('c11'), card('c12')], page: 2, total: 12, generatedAt: '2026-09-30T03:06:00.000Z' }));
    renderAt('/home');
    await openPanel();
    await askQuestion('Việc sắp đến hạn?');
    await clickAsync(await within(panel()).findByRole('button', { name: 'Xem thêm (còn 2 việc)' }));
    expect(mocks.fetchMoreAnswer).toHaveBeenCalledWith('conv-1', 2);
    await waitFor(() => expect(within(panel()).getAllByRole('link')).toHaveLength(12));
    expect(within(panel()).queryByRole('button', { name: /Xem thêm/ })).not.toBeInTheDocument();
    expect(within(panel()).getByText('Tính trên 3 bảng bạn xem được. Lúc 10:06.')).toBeInTheDocument();

    // luot cu con the chua hien -> khong co nut (server chi "xem them" duoc cau tra loi cuoi)
    mocks.sendChatMessage.mockReset().mockResolvedValueOnce(reply()).mockResolvedValueOnce(reply({ text: 'Câu thứ hai.', cards: [card('x1')], total: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Hội thoại mới' }));
    await askQuestion('Một');
    await within(panel()).findByRole('button', { name: 'Xem thêm (còn 2 việc)' });
    await askQuestion('Hai');
    await within(panel()).findByText('Câu thứ hai.');
    expect(within(panel()).queryByRole('button', { name: /Xem thêm/ })).not.toBeInTheDocument();
    expect(within(panel()).getByText('Còn 2 việc chưa hiện — hỏi lại để xem đầy đủ.')).toBeInTheDocument();
  });

  it('"Xem thêm" 404 -> "Hội thoại đã hết hạn", cau sau gui KHONG kem ma cu; server bao nguoi da roi nhom -> hien ly do', async () => {
    mocks.sendChatMessage.mockResolvedValue(reply());
    mocks.fetchMoreAnswer.mockRejectedValueOnce(httpError(404));
    renderAt('/home');
    await openPanel();
    await askQuestion('Một');
    await clickAsync(await within(panel()).findByRole('button', { name: 'Xem thêm (còn 2 việc)' }));
    await within(panel()).findByText('Hội thoại đã hết hạn. Hãy hỏi lại câu hỏi.');
    await askQuestion('Hai');
    await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenCalledTimes(2));
    expect(mocks.sendChatMessage.mock.calls[1]![0].conversationId).toBeUndefined();

    mocks.fetchMoreAnswer.mockResolvedValueOnce(reply({ text: 'Không tìm thấy “người bạn hỏi” trong không gian “Nhóm A”.', cards: [], total: 0, page: 1 }));
    await clickAsync(await within(panel()).findByRole('button', { name: 'Xem thêm (còn 2 việc)' }));
    await within(panel()).findByText('Không tìm thấy “người bạn hỏi” trong không gian “Nhóm A”.');
    expect(within(panel()).queryByRole('button', { name: /Xem thêm/ })).not.toBeInTheDocument();
  });
});

describe('AssistantPanel: giu hoi thoai khi doi trang', () => {
  it('bam lien ket the doi layout van giu hoi thoai; sang trang bang thi cau tiep theo mang pham vi BOARD (khoa trong bang do)', async () => {
    mocks.sendChatMessage.mockResolvedValue(reply());
    renderAt('/home');
    await openPanel();
    await askQuestion('Việc sắp đến hạn?');
    const link = await within(panel()).findByRole('link', { name: /Việc c3\b/ });
    link.focus();
    fireEvent.click(link);
    // Loi tim thay khi thu tren trinh duyet: con tro o lai lien ket trong panel -> Esc (dinh dong the
    // vua mo) lai dong panel. Bam lien ket phai dua con tro ra khoi panel.
    expect(document.activeElement).not.toBe(link);
    expect(panel().contains(document.activeElement)).toBe(false);
    expect(screen.getByTestId('location')).toHaveTextContent('/boards/b1?card=c3');
    expect(screen.getByTestId('layout-board')).toBeInTheDocument();
    expect(screen.queryByTestId('layout-main')).not.toBeInTheDocument();

    // panel + hoi thoai con nguyen; nut tren layout moi biet panel dang mo
    expect(within(panel()).getByText('Bạn có 12 việc sắp đến hạn trong 7 ngày tới.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trợ lý' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel()).queryByRole('radio')).not.toBeInTheDocument();

    await askQuestion('còn tuần sau?');
    await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenCalledTimes(2));
    expect(mocks.sendChatMessage.mock.calls[1]![0]).toEqual({ message: 'còn tuần sau?', scope: { kind: 'BOARD', boardId: 'b1' }, conversationId: 'conv-1' });

    fireEvent.click(screen.getByRole('button', { name: 'Hội thoại mới' }));
    expect(within(panel()).queryByRole('list', { name: 'Hội thoại' })).not.toBeInTheDocument();
    await askQuestion('Những việc nào chưa được phân công?');
    await waitFor(() => expect(mocks.sendChatMessage).toHaveBeenCalledTimes(3));
    expect(mocks.sendChatMessage.mock.calls[2]![0]).toEqual({ message: 'Những việc nào chưa được phân công?', scope: { kind: 'BOARD', boardId: 'b1' }, conversationId: undefined });
  });
});

describe('AssistantPanel: roi bang thi lam moi hoi thoai', () => {
  const OLD_TEXT = 'Bạn có 12 việc sắp đến hạn trong 7 ngày tới.';
  const lastBody = () => mocks.sendChatMessage.mock.calls.at(-1)![0];
  const go = async (to: string) => { await act(async () => { goTo(to); }); };
  const closePanel = () => clickAsync(screen.getByRole('button', { name: 'Đóng trợ lý' }));
  const saved = (id: string, question: string): ChatConversationHistory => ({ conversation: { id, title: question, updatedAt: GENERATED },
    turns: [{ id: 7, question, reply: { ...reply({ cards: [], blocks: [] }, {}, id), version: 'v2' }, error: null, createdAt: GENERATED }], hasMore: false, before: 7,
  });

  it('chat trong bang b1 -> sang bang b2: mo lai tro ly la hoi thoai trang, cau tiep theo khong noi ma cu va mang pham vi b2', async () => {
    mocks.sendChatMessage.mockResolvedValue(reply());
    renderAt('/boards/b1'); await openPanel();
    await askQuestion('Việc sắp đến hạn?');
    expect(within(panel()).getByText(OLD_TEXT)).toBeInTheDocument();

    await closePanel();
    await go('/boards/b2');
    await openPanel();
    expect(within(panel()).queryByText(OLD_TEXT)).not.toBeInTheDocument();
    expect(within(panel()).queryByRole('list', { name: 'Hội thoại' })).not.toBeInTheDocument();
    expect(within(panel()).getByText('Thử hỏi:')).toBeInTheDocument();

    await askQuestion('Còn việc nào?');
    expect(lastBody()).toEqual({ message: 'Còn việc nào?', scope: { kind: 'BOARD', boardId: 'b2' }, conversationId: undefined });
  });

  it('roi bang ra trang chu: panel dang mo cung ve hoi thoai trang; cau tiep theo o pham vi MY va khong noi ma cu', async () => {
    mocks.sendChatMessage.mockResolvedValue(reply());
    renderAt('/boards/b1'); await openPanel();
    await askQuestion('Việc sắp đến hạn?');
    await go('/home');
    expect(within(panel()).queryByText(OLD_TEXT)).not.toBeInTheDocument();
    expect(within(panel()).getByText('Thử hỏi:')).toBeInTheDocument();

    await askQuestion('Tôi đang ở bao nhiêu bảng?');
    expect(lastBody()).toEqual({ message: 'Tôi đang ở bao nhiêu bảng?', scope: { kind: 'MY' }, conversationId: undefined });
  });

  it('van o cung bang (mo the bang ?card=): hoi thoai con nguyen, cau tiep theo noi tiep ma cu', async () => {
    mocks.sendChatMessage.mockResolvedValue(reply());
    renderAt('/boards/b1'); await openPanel();
    await askQuestion('Việc sắp đến hạn?');
    await go('/boards/b1?card=c3');
    expect(within(panel()).getByText(OLD_TEXT)).toBeInTheDocument();
    await go('/boards/b1/'); // pathname doi (dau / cuoi) nhung van la bang b1
    expect(within(panel()).getByText(OLD_TEXT)).toBeInTheDocument();

    await askQuestion('còn tuần sau?');
    expect(lastBody()).toEqual({ message: 'còn tuần sau?', scope: { kind: 'BOARD', boardId: 'b1' }, conversationId: 'conv-1' });
  });

  it('trang chu -> bang van giu hoi thoai (bat dau ngoai bang); roi bang do thi moi lam moi', async () => {
    mocks.sendChatMessage.mockResolvedValue(reply());
    renderAt('/home'); await openPanel();
    await askQuestion('Việc sắp đến hạn?');
    await go('/boards/b1');
    expect(within(panel()).getByText(OLD_TEXT)).toBeInTheDocument();
    await go('/workspaces/w1');
    expect(within(panel()).queryByText(OLD_TEXT)).not.toBeInTheDocument();
  });

  it('dang cho tra loi thi roi bang: tra loi tre khong hien o hoi thoai moi va khong gan ma cu cho cau tiep theo', async () => {
    let resolveSend!: (r: ChatReply) => void;
    mocks.sendChatMessage.mockReturnValueOnce(new Promise<ChatReply>((res) => { resolveSend = res; }));
    renderAt('/boards/b1'); await openPanel();
    await askQuestion('Việc sắp đến hạn?');
    await go('/boards/b2');
    await act(async () => { resolveSend(reply()); });
    expect(within(panel()).queryByText(OLD_TEXT)).not.toBeInTheDocument();
    expect(within(panel()).queryByRole('list', { name: 'Hội thoại' })).not.toBeInTheDocument();

    mocks.sendChatMessage.mockResolvedValue(reply({ text: 'Trả lời mới.' }, {}, 'conv-2'));
    await askQuestion('Câu mới');
    expect(mocks.sendChatMessage).toHaveBeenCalledTimes(2);
    expect(lastBody()).toEqual({ message: 'Câu mới', scope: { kind: 'BOARD', boardId: 'b2' }, conversationId: undefined });
  });

  describe('yeu cau khac dang bay luc roi bang (v2): ket qua tre khong lam hong hoi thoai moi', () => {
    const v2Reply = (over: Partial<ChatAnswer>, cid: string): ChatReply => ({ ...reply({ cards: [], total: 0, blocks: [], ...over }, {}, cid), version: 'v2' });
    const clarify = { question: 'Chọn thẻ nào?', options: [{ id: 'o1', label: 'Login UI · Cần làm', kind: 'TARGET' as const }] };
    beforeEach(() => { mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2', actions: true }); });

    it('"Xem thêm" bao het han tre: khong xoa ma cua hoi thoai moi', async () => {
      mocks.sendChatMessage.mockResolvedValueOnce(v2Reply({ blocks: [v2Block('q', 'Công việc', ['a'], 1, true)] }, 'conv-1'));
      let rejectMore!: (e: unknown) => void;
      mocks.fetchMoreAnswer.mockReturnValueOnce(new Promise((_, rej) => { rejectMore = rej; }));
      renderAt('/boards/b1'); await openPanel();
      await askQuestion('Việc sắp đến hạn?');
      await clickAsync(within(panel()).getByRole('button', { name: 'Xem thêm: Công việc' }));
      await go('/boards/b2');
      mocks.sendChatMessage.mockResolvedValueOnce(v2Reply({}, 'conv-2'));
      await askQuestion('Câu mới');
      await act(async () => { rejectMore(httpError(404)); });
      mocks.sendChatMessage.mockResolvedValueOnce(v2Reply({}, 'conv-2'));
      await askQuestion('Câu nữa');
      expect(lastBody()).toEqual({ message: 'Câu nữa', scope: { kind: 'BOARD', boardId: 'b2' }, conversationId: 'conv-2' });
    });

    it('nut chon tra loi tre: khong hien va khong doi ma hoi thoai moi sang ma cu', async () => {
      mocks.sendChatMessage.mockResolvedValueOnce(v2Reply({ clarify }, 'conv-1'));
      let resolveChoice!: (r: ChatReply) => void;
      mocks.sendChatChoice.mockReturnValueOnce(new Promise<ChatReply>((res) => { resolveChoice = res; }));
      renderAt('/boards/b1'); await openPanel();
      await askQuestion('Chuyển Login sang Đang làm');
      await clickAsync(within(panel()).getByRole('button', { name: 'Login UI · Cần làm' }));
      await go('/boards/b2');
      mocks.sendChatMessage.mockResolvedValueOnce(v2Reply({}, 'conv-2'));
      await askQuestion('Câu mới');
      await act(async () => { resolveChoice(v2Reply({ text: 'Đã chọn xong thẻ cũ.' }, 'conv-1')); });
      expect(within(panel()).queryByText('Đã chọn xong thẻ cũ.')).not.toBeInTheDocument();
      mocks.sendChatMessage.mockResolvedValueOnce(v2Reply({}, 'conv-2'));
      await askQuestion('Câu nữa');
      expect(lastBody()).toEqual({ message: 'Câu nữa', scope: { kind: 'BOARD', boardId: 'b2' }, conversationId: 'conv-2' });
    });

    it('mo hoi thoai tu lich su dang tai: roi bang thi khong nhap hoi thoai do vao panel', async () => {
      const item = { id: 'older', title: 'Hội thoại trước', createdAt: GENERATED, updatedAt: GENERATED, turnCount: 1 };
      mocks.fetchChatConversations.mockResolvedValue({ conversations: [item], page: 1, hasMore: false });
      mocks.fetchChatConversation.mockResolvedValueOnce({ conversation: { id: 'x', title: 'x', updatedAt: GENERATED }, turns: [], hasMore: false, before: null });
      let release!: (h: ChatConversationHistory) => void;
      mocks.fetchChatConversation.mockReturnValueOnce(new Promise<ChatConversationHistory>((res) => { release = res; }));
      renderAt('/boards/b1'); await openPanel();
      await clickAsync(within(panel()).getByRole('button', { name: 'Lịch sử trò chuyện' }));
      await clickAsync(within(panel()).getByRole('button', { name: /Hội thoại trước/ }));
      await go('/boards/b2');
      await act(async () => { release(saved('older', 'Câu hỏi trước')); });
      expect(within(panel()).queryByText('Câu hỏi trước')).not.toBeInTheDocument();
      await askQuestion('Câu mới');
      expect(lastBody()).toEqual({ message: 'Câu mới', scope: { kind: 'BOARD', boardId: 'b2' }, conversationId: undefined });
    });

    it('"Tải tin nhắn trước" dang cho: roi bang thi khong chen luot cu vao hoi thoai moi', async () => {
      mocks.fetchChatConversations.mockResolvedValue({ conversations: [{ id: 'saved', title: 'Hội thoại', createdAt: GENERATED, updatedAt: GENERATED, turnCount: 2 }], page: 1, hasMore: false });
      const turn = (id: number, question: string) => ({ id, question, reply: v2Reply({}, 'saved'), error: null, createdAt: GENERATED });
      mocks.fetchChatConversation.mockResolvedValueOnce({ conversation: { id: 'saved', title: 'Hội thoại', updatedAt: GENERATED }, turns: [turn(20, 'Câu sau')], hasMore: true, before: 20 });
      let release!: (h: ChatConversationHistory) => void;
      mocks.fetchChatConversation.mockReturnValueOnce(new Promise<ChatConversationHistory>((res) => { release = res; }));
      renderAt('/boards/b1'); await openPanel();
      await clickAsync(await within(panel()).findByRole('button', { name: 'Tải tin nhắn trước' }));
      await go('/boards/b2');
      await act(async () => { release({ conversation: { id: 'saved', title: 'Hội thoại', updatedAt: GENERATED }, turns: [turn(10, 'Câu trước')], hasMore: false, before: 10 }); });
      expect(within(panel()).queryByText('Câu trước')).not.toBeInTheDocument();
      expect(within(panel()).queryByRole('list', { name: 'Hội thoại' })).not.toBeInTheDocument();
    });
  });

  it('cau dang cho trang thai AI ma roi bang: khong gui cau cua bang cu sang pham vi cua trang moi', async () => {
    let resolveStatus!: (s: { llmAvailable: boolean; engine: 'v2' }) => void;
    mocks.fetchChatStatus
      .mockRejectedValueOnce(httpError(500)) // lan mo dau loi -> lan mo sau hoi lai trang thai
      .mockReturnValueOnce(new Promise((res) => { resolveStatus = res; }));
    renderAt('/boards/b1'); await openPanel();
    await closePanel();
    await openPanel();
    await askQuestion('Việc sắp đến hạn?'); // dang cho trang thai AI
    await go('/boards/b2');
    await act(async () => { resolveStatus({ llmAvailable: true, engine: 'v2' }); });
    expect(mocks.sendChatMessage).not.toHaveBeenCalled();
    expect(within(panel()).queryByText('Việc sắp đến hạn?')).not.toBeInTheDocument();
  });

  it('v2: roi bang thi khong dung lai hoi thoai gan nhat tu lich su, nhung hoi thoai van con trong danh sach lich su', async () => {
    mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2' });
    const recent = { id: 'recent', title: 'Hội thoại gần nhất', createdAt: GENERATED, updatedAt: GENERATED, turnCount: 1 };
    mocks.fetchChatConversations.mockResolvedValue({ conversations: [recent], page: 1, hasMore: false });
    mocks.fetchChatConversation.mockResolvedValue(saved('recent', 'Câu hỏi gần nhất'));
    renderAt('/boards/b1'); await openPanel();
    expect(await within(panel()).findByText('Câu hỏi gần nhất')).toBeInTheDocument();

    await closePanel();
    await go('/boards/b2');
    await openPanel();
    expect(within(panel()).queryByText('Câu hỏi gần nhất')).not.toBeInTheDocument();
    expect(mocks.fetchChatConversation).toHaveBeenCalledTimes(1);

    await clickAsync(within(panel()).getByRole('button', { name: 'Lịch sử trò chuyện' }));
    expect(within(panel()).getByRole('button', { name: /Hội thoại gần nhất/ })).toBeInTheDocument();
  });

  it('v2: dang tai hoi thoai gan nhat luc mo lan dau thi roi bang: khong nhap hoi thoai do vao panel', async () => {
    mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2' });
    mocks.fetchChatConversations.mockResolvedValue({ conversations: [{ id: 'recent', title: 'Hội thoại gần nhất', createdAt: GENERATED, updatedAt: GENERATED, turnCount: 1 }], page: 1, hasMore: false });
    let release!: (h: ChatConversationHistory) => void;
    mocks.fetchChatConversation.mockReturnValue(new Promise<ChatConversationHistory>((res) => { release = res; }));
    renderAt('/boards/b1'); await openPanel();
    await go('/boards/b2');
    await act(async () => { release(saved('recent', 'Câu hỏi gần nhất')); });
    expect(within(panel()).queryByText('Câu hỏi gần nhất')).not.toBeInTheDocument();
    expect(within(panel()).getByText('Thử hỏi:')).toBeInTheDocument();
  });

  describe('khoi phuc hoi thoai khi mo tro ly lan dau chi lay hoi thoai CUA trang dang mo', () => {
    const conv = (id: string, title: string, scope: ChatConversationSummary['scope']): ChatConversationSummary => ({ id, title, createdAt: GENERATED, updatedAt: GENERATED, turnCount: 1, scope });

    it('vao bang B (tai trang / mo tab moi) khi hoi thoai gan nhat thuoc bang A -> de trong, hoi thoai bang A van o danh sach', async () => {
      mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2' });
      mocks.fetchChatConversations.mockResolvedValue({ conversations: [conv('a', 'Hội thoại bảng A', { kind: 'BOARD', boardId: 'bA' })], page: 1, hasMore: false });
      mocks.fetchChatConversation.mockResolvedValue(saved('a', 'Câu hỏi của bảng A'));
      renderAt('/boards/bB'); await openPanel();
      expect(within(panel()).getByText('Thử hỏi:')).toBeInTheDocument();
      expect(within(panel()).queryByText('Câu hỏi của bảng A')).not.toBeInTheDocument();
      expect(within(panel()).queryByText(/Đã mở hội thoại đã lưu/)).not.toBeInTheDocument();
      expect(mocks.fetchChatConversation).not.toHaveBeenCalled();
      await clickAsync(within(panel()).getByRole('button', { name: 'Lịch sử trò chuyện' }));
      expect(within(panel()).getByRole('button', { name: /Hội thoại bảng A/ })).toBeInTheDocument();
    });

    it('lay hoi thoai gan nhat CUA bang dang mo, bo qua hoi thoai moi hon cua bang khac', async () => {
      mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2' });
      mocks.fetchChatConversations.mockResolvedValue({
        conversations: [conv('a', 'Hội thoại bảng A', { kind: 'BOARD', boardId: 'bA' }), conv('b', 'Hội thoại bảng B', { kind: 'BOARD', boardId: 'bB' })],
        page: 1,
        hasMore: false,
      });
      mocks.fetchChatConversation.mockImplementation(async (id: string) => saved(id, id === 'b' ? 'Câu hỏi của bảng B' : 'Câu hỏi của bảng A'));
      renderAt('/boards/bB'); await openPanel();
      expect(await within(panel()).findByText('Câu hỏi của bảng B')).toBeInTheDocument();
      expect(mocks.fetchChatConversation).toHaveBeenCalledTimes(1);
      expect(mocks.fetchChatConversation).toHaveBeenCalledWith('b');
    });

    it('o trang chu chi khoi phuc hoi thoai bat dau ngoai bang, khong lay hoi thoai cua mot bang', async () => {
      mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2' });
      mocks.fetchChatConversations.mockResolvedValue({
        conversations: [conv('a', 'Hội thoại bảng A', { kind: 'BOARD', boardId: 'bA' }), conv('home', 'Hội thoại trang chủ', { kind: 'MY' })],
        page: 1,
        hasMore: false,
      });
      mocks.fetchChatConversation.mockImplementation(async (id: string) => saved(id, id === 'home' ? 'Câu hỏi trang chủ' : 'Câu hỏi của bảng A'));
      renderAt('/home'); await openPanel();
      expect(await within(panel()).findByText('Câu hỏi trang chủ')).toBeInTheDocument();
      expect(mocks.fetchChatConversation).toHaveBeenCalledWith('home');
      expect(within(panel()).queryByText('Câu hỏi của bảng A')).not.toBeInTheDocument();
    });
  });
});

describe('AssistantPanel: cau tra loi danh muc (§18)', () => {
  const table = (over: Partial<NonNullable<ChatAnswer['table']>> = {}): NonNullable<ChatAnswer['table']> => ({
    columns: ['Bảng', 'Không gian', 'Bạn là'],
    rows: [
      { cells: ['Kế hoạch Marketing', 'Nhóm A', 'Chủ bảng'], boardId: 'b1' },
      { cells: ['Việc cá nhân', 'Cá nhân', 'Xem nhờ không gian'], boardId: 'b/2' },
    ],
    total: 2,
    ...over,
  });
  const catalogAnswer = (over: Partial<ChatAnswer> = {}): Partial<ChatAnswer> => ({
    text: 'Bạn xem được 2 bảng, trong đó bạn tham gia trực tiếp 1 bảng.',
    facts: [{ key: 'total', label: 'Bảng xem được', value: 2 }],
    cards: [],
    total: 0,
    notes: ['Chỉ tính bảng bạn có quyền đọc.'],
    suggestions: ['Tôi thuộc những không gian nào?'],
    table: table(),
    ...over,
  });

  it('bang ket qua: tieu de cot, dong, o dau la lien ket mo bang (id duoc ma hoa), khong co danh sach viec / "Xem them"; bam lien ket doi trang va roi khoi panel', async () => {
    mocks.sendChatMessage.mockResolvedValue(reply(catalogAnswer(), { intent: 'MY_BOARDS', period: null, focus: null }));
    renderAt('/home');
    await openPanel();
    await askQuestion('Tôi đang ở bao nhiêu bảng?');
    const t = await within(panel()).findByRole('table');
    expect(within(t).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Bảng', 'Không gian', 'Bạn là']);
    expect(within(t).getAllByRole('row')).toHaveLength(3);
    expect(panel()).toHaveTextContent('Trợ lý hiểu là: các bảng của bạn');
    expect(panel()).toHaveTextContent('Bạn xem được 2 bảng, trong đó bạn tham gia trực tiếp 1 bảng.');
    expect(panel()).toHaveTextContent('Chỉ tính bảng bạn có quyền đọc.');
    expect(within(panel()).queryByRole('list', { name: 'Danh sách việc' })).not.toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: /Xem thêm/ })).not.toBeInTheDocument();

    const first = within(t).getByRole('link', { name: 'Kế hoạch Marketing' });
    expect(first).toHaveAttribute('href', '/boards/b1');
    expect(within(t).getByRole('link', { name: 'Việc cá nhân' })).toHaveAttribute('href', '/boards/b%2F2'); // id co ky tu dac biet duoc ma hoa
    expect(within(t).getAllByRole('link')).toHaveLength(2); // chi o dau cua moi dong
    expect(within(t).getByText('Xem nhờ không gian')).toBeInTheDocument();

    first.focus();
    fireEvent.click(first);
    expect(panel().contains(document.activeElement)).toBe(false); // giong lien ket the: Esc khong dong panel
    expect(screen.getByTestId('location')).toHaveTextContent('/boards/b1');
    expect(within(panel()).getByText('Tôi đang ở bao nhiêu bảng?')).toBeInTheDocument(); // hoi thoai con nguyen
  });

  it('dem the theo cot: so canh phai, dong "hiểu là" co ten bang / cot da nhan dien; dong khong co boardId khong la lien ket', async () => {
    mocks.sendChatMessage.mockResolvedValue(
      reply(
        catalogAnswer({
          text: 'Bảng “Sprint 12” có 6 thẻ: 4 chưa xong, 2 đã hoàn thành.',
          table: { columns: ['Cột', 'Chưa xong', 'Đã xong', 'Tổng'], rows: [{ cells: ['Đang làm', 4, 0, 4] }, { cells: ['Xong', 0, 2, 2] }], total: 2 },
          facts: [{ key: 'open', label: 'Chưa xong', value: 4 }],
        }),
        { intent: 'CARD_COUNTS', period: null, focus: null, targetName: 'Sprint 12', columnName: null }
      )
    );
    renderAt('/home');
    await openPanel();
    await askQuestion('Bảng Sprint 12 có bao nhiêu thẻ?');
    const t = await within(panel()).findByRole('table');
    expect(panel()).toHaveTextContent('Trợ lý hiểu là: số thẻ · Sprint 12');
    expect(within(t).queryByRole('link')).not.toBeInTheDocument();
    const cells = within(t).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toEqual(['Đang làm', '4', '0', '4', 'Xong', '0', '2', '2']);
    expect(cells[0]).not.toHaveClass('text-right');
    for (const numeric of [cells[1], cells[2], cells[3], cells[7]]) expect(numeric).toHaveClass('text-right', 'tabular-nums');
    expect(within(t).getAllByRole('columnheader')[1]).toHaveClass('text-right');
    expect(within(t).getAllByRole('columnheader')[0]).not.toHaveClass('text-right');
  });

  it('bang rong / khong co bang -> khong ve bang; cau tra loi van hien cau dan + so', async () => {
    mocks.sendChatMessage
      .mockResolvedValueOnce(reply(catalogAnswer({ text: 'Bạn chưa xem được bảng nào.', table: table({ rows: [], total: 0 }) }), { intent: 'MY_BOARDS' }))
      .mockResolvedValueOnce(reply(catalogAnswer({ text: 'Không tìm thấy bảng “abc”.', table: undefined, facts: [] }), { intent: 'CARD_COUNTS' }));
    renderAt('/home');
    await openPanel();
    await askQuestion('Tôi đang ở bao nhiêu bảng?');
    await within(panel()).findByText('Bạn chưa xem được bảng nào.');
    expect(within(panel()).queryByRole('table')).not.toBeInTheDocument();
    await askQuestion('Bảng abc có bao nhiêu thẻ?');
    await within(panel()).findByText('Không tìm thấy bảng “abc”.');
    expect(within(panel()).queryByRole('table')).not.toBeInTheDocument();
  });

  it('trung ten bang / khong gian: nut chon kieu TARGET gui targetId; lua chon cu khong bam duoc nua; ket qua co bang', async () => {
    mocks.sendChatMessage.mockResolvedValueOnce(
      reply(
        {
          kind: 'CLARIFY',
          text: 'Có nhiều bảng hoặc không gian khớp với “Website”. Ý bạn là cái nào?',
          cards: [],
          total: 0,
          facts: [],
          suggestions: [],
          notes: [],
          clarify: {
            question: 'Ý bạn là cái nào?',
            options: [
              { id: 'b4', label: 'Bảng Website (Kỹ thuật)', kind: 'TARGET' },
              { id: 'b10', label: 'Bảng Website (Marketing)', kind: 'TARGET' },
            ],
          },
        },
        { intent: 'CARD_COUNTS', period: null, focus: null }
      )
    );
    mocks.sendChatChoice.mockResolvedValue(
      reply(
        catalogAnswer({ text: 'Bảng “Website” có 3 thẻ: 3 chưa xong, 0 đã hoàn thành.', table: { columns: ['Cột', 'Tổng'], rows: [{ cells: ['Cần làm', 3] }], total: 1 } }),
        { intent: 'CARD_COUNTS', targetName: 'Website' }
      )
    );
    renderAt('/home');
    await openPanel();
    await askQuestion('Bảng Website có bao nhiêu thẻ?');
    const group = await within(panel()).findByRole('group', { name: 'Ý bạn là cái nào?' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Bảng Website (Kỹ thuật)', 'Bảng Website (Marketing)']);
    await clickAsync(within(group).getByRole('button', { name: 'Bảng Website (Marketing)' }));
    expect(mocks.sendChatChoice).toHaveBeenCalledWith('conv-1', { id: 'b10', label: 'Bảng Website (Marketing)', kind: 'TARGET' });
    await within(panel()).findByText('Bảng “Website” có 3 thẻ: 3 chưa xong, 0 đã hoàn thành.');
    expect(within(panel()).getByText('Chọn: Bảng Website (Marketing)')).toBeInTheDocument();
    expect(panel()).toHaveTextContent('Trợ lý hiểu là: số thẻ · Website');
    expect(within(panel()).getByRole('table')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Bảng Website (Kỹ thuật)' })).toBeDisabled();
  });

  it('cau hoi nhanh thu nam ("Tôi đang ở bao nhiêu bảng?") gui dung chu voi pham vi hien tai', async () => {
    mocks.sendChatMessage.mockResolvedValue(reply(catalogAnswer(), { intent: 'MY_BOARDS' }));
    renderAt('/home');
    await openPanel();
    const quick = within(panel()).getAllByRole('button').filter((b) => QUICK_QUESTIONS.includes(b.textContent ?? ''));
    expect(quick.map((b) => b.textContent)).toEqual(QUICK_QUESTIONS);
    await clickAsync(within(panel()).getByRole('button', { name: 'Tôi đang ở bao nhiêu bảng?' }));
    expect(mocks.sendChatMessage).toHaveBeenCalledWith({ message: 'Tôi đang ở bao nhiêu bảng?', scope: { kind: 'MY' }, conversationId: undefined });
    await within(panel()).findByRole('table');
  });
});

describe('AssistantPanel v2', () => {
  it('restores the latest conversation, opens an older one, and starts a new chat without losing history', async () => {
    mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2' });
    const recent = { id: 'recent', title: 'Hội thoại gần nhất', createdAt: GENERATED, updatedAt: GENERATED, turnCount: 1 };
    const older = { ...recent, id: 'older', title: 'Hội thoại trước' };
    mocks.fetchChatConversations.mockResolvedValue({ conversations: [recent, older], page: 1, hasMore: false });
    const saved = (id: string, question: string): ChatConversationHistory => ({ conversation: { id, title: question, updatedAt: GENERATED },
      turns: [{ id: 42, question, reply: { ...reply({ cards: [], blocks: [v2Block(id, 'Công việc đã lưu', ['saved'])] }, {}, id), version: 'v2' }, error: null, createdAt: GENERATED }], hasMore: false, before: 42,
    });
    mocks.fetchChatConversation.mockImplementation(async (id: string) => saved(id, id === 'recent' ? 'Câu hỏi gần nhất' : 'Câu hỏi trước'));
    mocks.sendChatMessage.mockResolvedValue({ ...reply({ cards: [], blocks: [] }, {}, 'next'), version: 'v2' });
    const first = renderAt('/home'); await openPanel();
    expect(await within(panel()).findByText('Câu hỏi gần nhất')).toBeInTheDocument();
    first.unmount();
    renderAt('/boards/b1'); await openPanel();
    expect(await within(panel()).findByText('Câu hỏi gần nhất')).toBeInTheDocument();
    await clickAsync(within(panel()).getByRole('button', { name: 'Lịch sử trò chuyện' }));
    await clickAsync(within(panel()).getByRole('button', { name: /Hội thoại trước/ }));
    expect(await within(panel()).findByText('Câu hỏi trước')).toBeInTheDocument();
    await askQuestion('còn việc nào?');
    expect(mocks.sendChatMessage).toHaveBeenLastCalledWith({ message: 'còn việc nào?', scope: { kind: 'BOARD', boardId: 'b1' }, conversationId: 'older' }, 'v2');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Hội thoại mới' }));
    expect(within(panel()).queryByText('Câu hỏi trước')).not.toBeInTheDocument();
    await askQuestion('Câu hỏi mới');
    expect(mocks.sendChatMessage).toHaveBeenLastCalledWith({ message: 'Câu hỏi mới', scope: { kind: 'BOARD', boardId: 'b1' }, conversationId: undefined }, 'v2');
    await clickAsync(within(panel()).getByRole('button', { name: 'Lịch sử trò chuyện' }));
    expect(within(panel()).getByRole('button', { name: /Hội thoại trước/ })).toBeInTheDocument();
  });
  it('loads earlier saved turns in order without replacing the current conversation', async () => {
    mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2' });
    mocks.fetchChatConversations.mockResolvedValue({ conversations: [{ id: 'saved', title: 'Hội thoại', createdAt: GENERATED, updatedAt: GENERATED, turnCount: 2 }], page: 1, hasMore: false });
    const turn = (id: number, question: string) => ({ id, question, reply: { ...reply({ cards: [], blocks: [] }, {}, 'saved'), version: 'v2' as const }, error: null, createdAt: GENERATED });
    mocks.fetchChatConversation.mockResolvedValueOnce({ conversation: { id: 'saved' }, turns: [turn(20, 'Câu sau')], hasMore: true, before: 20 })
      .mockResolvedValueOnce({ conversation: { id: 'saved' }, turns: [turn(10, 'Câu trước')], hasMore: false, before: 10 });
    renderAt('/home'); await openPanel();
    await clickAsync(await within(panel()).findByRole('button', { name: 'Tải tin nhắn trước' }));
    expect(mocks.fetchChatConversation).toHaveBeenLastCalledWith('saved', 20);
    const list = within(panel()).getByRole('list', { name: 'Hội thoại' });
    expect(list.textContent!.indexOf('Câu trước')).toBeLessThan(list.textContent!.indexOf('Câu sau'));
    expect(within(panel()).queryByRole('button', { name: 'Tải tin nhắn trước' })).not.toBeInTheDocument();
  });
  it('shows history loading errors and lets the user retry without discarding the current chat', async () => {
    mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2' });
    mocks.fetchChatConversations.mockRejectedValueOnce(httpError(500)).mockResolvedValue({ conversations: [], page: 1, hasMore: false });
    renderAt('/home'); await openPanel();
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('Không thể tải lịch sử trò chuyện');
    await clickAsync(within(panel()).getByRole('button', { name: 'Thử lại' }));
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(panel()).getByRole('textbox')).toBeInTheDocument();
  });
  it('does not silently send questions to legacy when v2 status discovery fails', async () => {
    mocks.fetchChatStatus.mockRejectedValueOnce(httpError(404));
    mocks.sendChatMessage.mockResolvedValue({ ...reply({ cards: [], blocks: [v2Block('assigned', 'Công việc đã được phân công', ['a'])] }), version: 'v2', mode: 'BASIC' });
    renderAt('/home'); await openPanel();
    const message = 'Trong bảng 1234 những công việc nào đã được gán thành viên?';
    await askQuestion(message);
    expect(mocks.sendChatMessage).toHaveBeenCalledWith({ message, scope: { kind: 'MY' }, conversationId: undefined }, 'v2');
    expect(within(panel()).getByRole('region', { name: 'Công việc đã được phân công' })).toBeInTheDocument();
  });
  it('uses server-selected v2, renders two independent lists and loads only the selected block', async () => {
    mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2' });
    const assigned = v2Block('assigned', 'Công việc đã được phân công', ['a']);
    const unassigned = v2Block('unassigned', 'Công việc chưa được phân công', ['u1', 'u2'], 1, true);
    mocks.sendChatMessage.mockResolvedValue({ ...reply({ cards: [], total: 0, blocks: [assigned, unassigned] }), version: 'v2', mode: 'AI' });
    const incoming = v2Block('unassigned', unassigned.title, ['u3'], 2);
    mocks.fetchMoreAnswer.mockResolvedValue({ ...reply({ cards: [], blocks: [incoming] }), version: 'v2', mode: 'BASIC' });
    renderAt('/home'); await openPanel();
    const sentence = 'trong bảng 1234 công việc nào đã được phân công và những công việc nào chưa được phân công';
    await askQuestion(sentence);
    expect(mocks.sendChatMessage).toHaveBeenCalledWith({ message: sentence, scope: { kind: 'MY' }, conversationId: undefined }, 'v2');
    const a = within(panel()).getByRole('region', { name: assigned.title });
    const u = within(panel()).getByRole('region', { name: unassigned.title });
    expect(within(a).getByRole('link', { name: /Việc a/ })).toHaveAttribute('href', '/boards/b1?card=a');
    expect(within(u).getByText('Tính cả việc đã xong')).toBeInTheDocument();
    await clickAsync(within(u).getByRole('button', { name: `Xem thêm: ${unassigned.title}` }));
    expect(mocks.fetchMoreAnswer).toHaveBeenCalledWith('conv-1', 2, 'unassigned', 'v2');
    expect(within(u).getByRole('link', { name: /Việc u1/ })).toBeInTheDocument();
    expect(within(u).getByRole('link', { name: /Việc u3/ })).toBeInTheDocument();
    expect(within(a).getByRole('link', { name: /Việc a/ })).toBeInTheDocument();
    expect(within(u).queryByRole('button', { name: /Xem thêm/ })).not.toBeInTheDocument();
  });
  it('renders partial failure and submits only a server clarification option to v2', async () => {
    mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2' });
    mocks.sendChatMessage.mockResolvedValue({ ...reply({ cards: [], total: 0,
      blocks: [v2Block('ok', 'Kết quả đã tra cứu', ['a']), { id: 'error', title: 'Phần chưa trả lời', status: 'ERROR', error: 'Không thể tra cứu phần này lúc này.' }],
      clarify: { question: 'Bạn muốn chọn bảng nào?', options: [{ id: 'b1', label: '1234 · Nhóm A', kind: 'TARGET' }] },
    }), version: 'v2', mode: 'AI' });
    mocks.sendChatChoice.mockResolvedValue({ ...reply({ cards: [], blocks: [v2Block('new', 'Công việc', ['u1'])] }), version: 'v2' });
    renderAt('/home'); await openPanel(); await askQuestion('hỏi hai phần');
    expect(within(panel()).getByRole('alert')).toHaveTextContent('Không thể tra cứu phần này lúc này.');
    await clickAsync(within(panel()).getByRole('button', { name: '1234 · Nhóm A' }));
    expect(mocks.sendChatChoice).toHaveBeenCalledWith('conv-1', { id: 'b1', label: '1234 · Nhóm A', kind: 'TARGET' }, 'v2');
  });
});

// ===================== Thao tac (Phase 1): xem truoc / Ap dung / Huy / ket qua =====================

describe('AssistantPanel: thao tac cua tro ly', () => {
  const plan = (over: Partial<ChatActionPlan> = {}): ChatActionPlan => ({
    planId: 'p1', checksum: 'a'.repeat(64), status: 'PROPOSED', risk: 'LOW', requiresConfirmation: true, canConfirm: true,
    reasons: [{ code: 'AUTO_DISABLED', text: 'Chế độ tự chạy đang tắt nên mọi thao tác cần bạn xác nhận.' }],
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), boardId: 'b1', boardName: 'Bảng Marketing',
    items: [{ index: 0, verb: 'Chuyển thẻ', text: '“Login UI”', detail: '“Cần làm” → “Đang làm”', cardId: 'c1' }], warnings: [], ...over,
  });
  const result = (over: Partial<ChatActionResult> = {}): ChatActionResult => ({
    planId: 'p1', status: 'EXECUTED', autoExecuted: false, summary: 'Đã chuyển thẻ “Login UI” từ cột “Cần làm” sang “Đang làm”.', boardId: 'b1', cardId: 'c1', warnings: [], ...over,
  });
  const actionReply = (action: NonNullable<ChatAnswer['action']>, text = 'Mình sẽ làm như sau.', cid = 'conv-1'): ChatReply =>
    ({ ...reply({ cards: [], total: 0, blocks: [], notes: [], suggestions: [], facts: [], text, action }, {}, cid), version: 'v2', mode: 'AI' });
  const planBlock = () => within(panel()).getByRole('region', { name: 'Kế hoạch thao tác' });
  const resultBlock = () => within(panel()).getByRole('region', { name: 'Kết quả thao tác' });

  beforeEach(() => {
    mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2', actions: true });
  });

  it('gioi thieu: bat hanh dong thi neu cac thao tac (ke ca noi dung, luu tru) + vi du, tat thi noi ro chi doc', async () => {
    renderAt('/home'); await openPanel();
    expect(await within(panel()).findByText(/Với thẻ: tạo, đổi tên, đặt hạn và ngày bắt đầu, chuyển cột, đổi trạng thái, giao hoặc bỏ người, gắn hoặc gỡ nhãn/)).toBeInTheDocument();
    expect(within(panel()).getByText(/Với bảng \(chủ bảng hoặc quản trị viên\): đổi tên, chế độ hiển thị/)).toBeInTheDocument();
    expect(within(panel()).getByText('Chuyển task Login sang Đang làm')).toBeInTheDocument();
    expect(within(panel()).queryByText(/Trợ lý hiện chỉ đọc dữ liệu/)).not.toBeInTheDocument();
    expect(within(panel()).getByRole('textbox', { name: 'Câu hỏi cho trợ lý' })).toHaveAttribute('placeholder', expect.stringContaining('ra lệnh'));
  });
  it('gioi thieu: may chu khong bat hanh dong (hoac chua biet) -> chi doc', async () => {
    mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2', actions: false });
    renderAt('/home'); await openPanel();
    expect(await within(panel()).findByText(/Trợ lý hiện chỉ đọc dữ liệu/)).toBeInTheDocument();
    expect(within(panel()).queryByText(/Với thẻ: tạo, đổi tên/)).not.toBeInTheDocument();
  });

  it('lenh chua du chac chan -> khoi xem truoc (ten bang, tung thao tac, ly do, gio het han); bam Ap dung -> thay bang ket qua, KHONG them luot moi', async () => {
    mocks.sendChatMessage.mockResolvedValue(actionReply({ kind: 'PLAN', plan: plan() }));
    mocks.confirmChatAction.mockResolvedValue(actionReply({ kind: 'RESULT', result: result() }, 'Đã chuyển thẻ.'));
    renderAt('/home'); await openPanel();
    await askQuestion('Chuyển Login UI sang Đang làm');
    const block = planBlock();
    expect(within(block).getByRole('link', { name: 'Bảng Marketing' })).toHaveAttribute('href', '/boards/b1');
    expect(within(block).getByText('Chuyển thẻ')).toBeInTheDocument();
    expect(within(block).getByText('“Cần làm” → “Đang làm”')).toBeInTheDocument();
    expect(within(block).getByRole('link', { name: 'Mở thẻ' })).toHaveAttribute('href', '/boards/b1?card=c1');
    expect(within(block).getByRole('note')).toHaveTextContent('Chế độ tự chạy đang tắt nên mọi thao tác cần bạn xác nhận.');
    expect(within(block).getByText(/Chưa có gì thay đổi\. Kế hoạch hết hạn lúc/)).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Áp dụng' })).toBeEnabled();

    await clickAsync(within(block).getByRole('button', { name: 'Áp dụng' }));
    expect(mocks.confirmChatAction).toHaveBeenCalledWith({ planId: 'p1', checksum: 'a'.repeat(64) }, 'conv-1', { kind: 'MY' });
    expect(within(panel()).queryByRole('region', { name: 'Kế hoạch thao tác' })).not.toBeInTheDocument();
    const done = resultBlock();
    expect(within(done).getByText('Đã thực hiện')).toBeInTheDocument();
    expect(within(done).getByText('Đã chuyển thẻ “Login UI” từ cột “Cần làm” sang “Đang làm”.')).toBeInTheDocument();
    expect(within(done).getByRole('link', { name: 'Mở thẻ' })).toHaveAttribute('href', '/boards/b1?card=c1');
    expect(within(panel()).queryByRole('button', { name: 'Áp dụng' })).not.toBeInTheDocument();
    expect(within(panel()).getAllByRole('listitem').filter((li) => li.textContent?.includes('Chuyển Login UI sang Đang làm'))).toHaveLength(1);
    expect(mocks.sendChatMessage).toHaveBeenCalledTimes(1);
  });

  it('lenh ro rang tu chay: hien ket qua ngay, ghi "theo lenh cua ban", khong co nut', async () => {
    mocks.sendChatMessage.mockResolvedValue(actionReply({ kind: 'RESULT', result: result({ autoExecuted: true }) }, result().summary));
    renderAt('/boards/b1'); await openPanel();
    await askQuestion('Chuyển Login UI sang Đang làm');
    const done = resultBlock();
    expect(within(done).getByText('Đã thực hiện · theo lệnh của bạn')).toBeInTheDocument();
    // câu tóm tắt chỉ hiện MỘT lần (khối kết quả), không lặp lại ở dòng dẫn
    expect(within(panel()).getAllByText(result().summary)).toHaveLength(1);
    expect(within(panel()).queryByRole('button', { name: 'Áp dụng' })).not.toBeInTheDocument();
    expect(mocks.sendChatMessage).toHaveBeenCalledWith({ message: 'Chuyển Login UI sang Đang làm', scope: { kind: 'BOARD', boardId: 'b1' }, conversationId: undefined }, 'v2');
  });

  it('nut Huy: goi huy dung ke hoach va thay the khoi bang ket qua da huy', async () => {
    mocks.sendChatMessage.mockResolvedValue(actionReply({ kind: 'PLAN', plan: plan() }));
    mocks.cancelChatAction.mockResolvedValue(actionReply({ kind: 'RESULT', result: result({ status: 'CANCELLED', summary: 'Đã hủy kế hoạch. Chưa thay đổi gì.', cardId: undefined }) }));
    renderAt('/home'); await openPanel();
    await askQuestion('Chuyển Login UI sang Đang làm');
    await clickAsync(within(planBlock()).getByRole('button', { name: 'Hủy' }));
    expect(mocks.cancelChatAction).toHaveBeenCalledWith('p1', 'conv-1');
    expect(mocks.confirmChatAction).not.toHaveBeenCalled();
    expect(within(resultBlock()).getByText('Đã hủy')).toBeInTheDocument();
    expect(within(resultBlock()).getByText('Đã hủy kế hoạch. Chưa thay đổi gì.')).toBeInTheDocument();
  });

  it('Ap dung bi tu choi (409 / 403 / mang): the van o trang thai xem truoc, hien loi tieng Viet co "chua thay doi", bam lai duoc', async () => {
    mocks.sendChatMessage.mockResolvedValue(actionReply({ kind: 'PLAN', plan: plan() }));
    renderAt('/home'); await openPanel();
    await askQuestion('Chuyển Login UI sang Đang làm');
    for (const [error, text] of [
      [httpError(409), 'Kế hoạch đã thay đổi hoặc đang được xử lý.'],
      [httpError(403), 'Bạn không có quyền thực hiện thao tác này'],
      [httpError(404), 'Không tìm thấy kế hoạch này'],
    ] as const) {
      mocks.confirmChatAction.mockRejectedValueOnce(error);
      await clickAsync(within(planBlock()).getByRole('button', { name: 'Áp dụng' }));
      expect(within(planBlock()).getByRole('alert')).toHaveTextContent(text);
      expect(within(planBlock()).getByRole('button', { name: 'Áp dụng' })).toBeEnabled();
    }
    expect(mocks.confirmChatAction).toHaveBeenCalledTimes(3);
  });

  it('Ap dung o TRANG BANG gui kem pham vi BOARD hien tai (server dung de huy ke hoach cua bang khac voi trang dang mo)', async () => {
    mocks.sendChatMessage.mockResolvedValue(actionReply({ kind: 'PLAN', plan: plan() }));
    mocks.confirmChatAction.mockResolvedValue(actionReply({ kind: 'RESULT', result: result() }));
    renderAt('/boards/b1'); await openPanel();
    await askQuestion('Chuyển Login UI sang Đang làm');
    await clickAsync(within(planBlock()).getByRole('button', { name: 'Áp dụng' }));
    expect(mocks.confirmChatAction).toHaveBeenCalledWith({ planId: 'p1', checksum: 'a'.repeat(64) }, 'conv-1', { kind: 'BOARD', boardId: 'b1' });
  });

  it('dang ap dung: nut khoa, hien "Dang ap dung..."; chi gui mot yeu cau du bam nhieu lan', async () => {
    mocks.sendChatMessage.mockResolvedValue(actionReply({ kind: 'PLAN', plan: plan() }));
    let finish!: (r: ChatReply) => void;
    mocks.confirmChatAction.mockReturnValue(new Promise<ChatReply>((r) => (finish = r)));
    renderAt('/home'); await openPanel();
    await askQuestion('Chuyển Login UI sang Đang làm');
    await clickAsync(within(planBlock()).getByRole('button', { name: 'Áp dụng' }));
    const pending = within(planBlock()).getByRole('button', { name: 'Đang áp dụng…' });
    expect(pending).toBeDisabled();
    expect(within(planBlock()).getByRole('button', { name: 'Hủy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeDisabled();
    fireEvent.click(pending);
    await act(async () => { finish(actionReply({ kind: 'RESULT', result: result() })); });
    expect(mocks.confirmChatAction).toHaveBeenCalledTimes(1);
    expect(within(panel()).getByRole('region', { name: 'Kết quả thao tác' })).toBeInTheDocument();
  });

  it('ke hoach het han (canConfirm=false hoac qua gio): khong cho Ap dung, noi ro chua thay doi gi', async () => {
    mocks.sendChatMessage.mockResolvedValue(actionReply({ kind: 'PLAN', plan: plan({ canConfirm: false, expiresAt: new Date(Date.now() - 60_000).toISOString() }) }));
    renderAt('/home'); await openPanel();
    await askQuestion('Chuyển Login UI sang Đang làm');
    expect(within(planBlock()).getByText('Kế hoạch đã hết hạn. Hãy gửi lại lệnh. Chưa thay đổi gì.')).toBeInTheDocument();
    expect(within(planBlock()).getByRole('button', { name: 'Áp dụng' })).toBeDisabled();
  });

  it('o trang bang khac voi bang cua ke hoach: khoa nut Ap dung (tran pham vi), khong goi API', async () => {
    mocks.sendChatMessage.mockResolvedValue(actionReply({ kind: 'PLAN', plan: plan({ boardId: 'b9' }) }));
    renderAt('/boards/b1'); await openPanel();
    await askQuestion('Chuyển Login UI sang Đang làm');
    expect(within(planBlock()).getByText(/thuộc bảng khác với bảng đang mở nên không áp dụng được ở đây/)).toBeInTheDocument();
    expect(within(planBlock()).getByRole('button', { name: 'Áp dụng' })).toBeDisabled();
    fireEvent.click(within(planBlock()).getByRole('button', { name: 'Áp dụng' }));
    expect(mocks.confirmChatAction).not.toHaveBeenCalled();
  });

  it('lenh moi tao ke hoach moi: ke hoach cu ngay lap tuc thanh "da bi thay the" (khop server), nut cu mat', async () => {
    mocks.sendChatMessage
      .mockResolvedValueOnce(actionReply({ kind: 'PLAN', plan: plan() }))
      .mockResolvedValueOnce(actionReply({ kind: 'PLAN', plan: plan({ planId: 'p2', checksum: 'b'.repeat(64) }) }, 'Mình sẽ làm như sau (2).'));
    renderAt('/home'); await openPanel();
    await askQuestion('Chuyển Login UI sang Đang làm');
    await askQuestion('Chuyển Login API sang Cần làm');
    expect(within(panel()).getAllByRole('button', { name: 'Áp dụng' })).toHaveLength(1);
    expect(within(panel()).getByText('Đã có lệnh mới hơn nên kế hoạch này bị thay thế. Chưa thay đổi gì.')).toBeInTheDocument();
    mocks.confirmChatAction.mockResolvedValue(actionReply({ kind: 'RESULT', result: result({ planId: 'p2' }) }));
    await clickAsync(within(panel()).getByRole('button', { name: 'Áp dụng' }));
    expect(mocks.confirmChatAction).toHaveBeenCalledWith({ planId: 'p2', checksum: 'b'.repeat(64) }, 'conv-1', { kind: 'MY' });
  });

  it('go "huy" -> server tra ket qua da huy cua dung ke hoach dang mo: the xem truoc cu doi theo', async () => {
    mocks.sendChatMessage
      .mockResolvedValueOnce(actionReply({ kind: 'PLAN', plan: plan() }))
      .mockResolvedValueOnce(actionReply({ kind: 'RESULT', result: result({ status: 'CANCELLED', summary: 'Đã hủy kế hoạch. Chưa thay đổi gì.', cardId: undefined }) }, 'Đã hủy kế hoạch. Chưa thay đổi gì.'));
    renderAt('/home'); await openPanel();
    await askQuestion('Chuyển Login UI sang Đang làm');
    await askQuestion('hủy');
    expect(within(panel()).queryByRole('button', { name: 'Áp dụng' })).not.toBeInTheDocument();
    expect(within(panel()).queryByRole('region', { name: 'Kế hoạch thao tác' })).not.toBeInTheDocument();
    expect(within(panel()).getAllByText('Đã hủy kế hoạch. Chưa thay đổi gì.').length).toBeGreaterThanOrEqual(1);
  });

  it('ket qua that bai / lech du lieu / da ap dung truoc do duoc the hien dung mau va loi giai thich', async () => {
    mocks.sendChatMessage.mockResolvedValue(actionReply({ kind: 'PLAN', plan: plan() }));
    mocks.confirmChatAction.mockResolvedValue(actionReply({ kind: 'RESULT', result: result({ status: 'STALE', cardId: undefined, summary: 'Thẻ đã được chuyển sang cột khác kể từ lúc xem trước. Chưa thay đổi gì.', error: { code: 'STALE', text: 'x' } }) }));
    renderAt('/home'); await openPanel();
    await askQuestion('Chuyển Login UI sang Đang làm');
    await clickAsync(within(planBlock()).getByRole('button', { name: 'Áp dụng' }));
    expect(within(resultBlock()).getByText('Dữ liệu đã thay đổi')).toBeInTheDocument();
    expect(within(resultBlock()).queryByRole('link', { name: 'Mở thẻ' })).not.toBeInTheDocument();
  });

  it('lich su mo lai: the xem truoc cu da co trang thai that tu server (ket qua) thi khong con nut', async () => {
    mocks.fetchChatConversations.mockResolvedValue({ conversations: [{ id: 'saved', title: 'Hội thoại', createdAt: GENERATED, updatedAt: GENERATED, turnCount: 2 }], page: 1, hasMore: false });
    const turn = (id: number, question: string, action: NonNullable<ChatAnswer['action']>) => ({ id, question, reply: actionReply(action, 'x', 'saved'), error: null, createdAt: GENERATED });
    mocks.fetchChatConversation.mockResolvedValue({ conversation: { id: 'saved', title: 'Hội thoại', updatedAt: GENERATED }, hasMore: false, before: 1,
      turns: [turn(1, 'Chuyển Login UI sang Đang làm', { kind: 'RESULT', result: result() }), turn(2, 'Áp dụng: Chuyển thẻ “Login UI”', { kind: 'RESULT', result: result({ alreadyApplied: true }) })] });
    renderAt('/home'); await openPanel();
    expect(await within(panel()).findAllByRole('region', { name: 'Kết quả thao tác' })).toHaveLength(2);
    expect(within(panel()).queryByRole('button', { name: 'Áp dụng' })).not.toBeInTheDocument();
    expect(within(panel()).getByText(/đã được áp dụng trước đó/)).toBeInTheDocument();
  });

  it('nut chon / xem them o TRANG BANG gui kem pham vi BOARD hien tai (de server vo hieu nut cua trang khac); o trang chu thi khong gui', async () => {
    const withClarify = (cid = 'conv-1'): ChatReply => ({ ...reply({ cards: [], total: 0, blocks: [v2Block('q', 'Công việc', ['a'], 1, true)], clarify: { question: 'Chọn thẻ nào?', options: [{ id: 'o1', label: 'Login UI · Cần làm', kind: 'TARGET' }] } }, {}, cid), version: 'v2', mode: 'AI' });
    mocks.sendChatMessage.mockResolvedValue(withClarify());
    mocks.sendChatChoice.mockResolvedValue(actionReply({ kind: 'RESULT', result: result({ autoExecuted: true }) }));
    mocks.fetchMoreAnswer.mockResolvedValue({ ...reply({ cards: [], blocks: [v2Block('q', 'Công việc', ['b'], 2)] }), version: 'v2' });
    const board = renderAt('/boards/b1'); await openPanel();
    await askQuestion('Chuyển Login sang Đang làm');
    await clickAsync(within(panel()).getByRole('button', { name: 'Xem thêm: Công việc' }));
    expect(mocks.fetchMoreAnswer).toHaveBeenLastCalledWith('conv-1', 2, 'q', 'v2', { kind: 'BOARD', boardId: 'b1' });
    await clickAsync(within(panel()).getByRole('button', { name: 'Login UI · Cần làm' }));
    expect(mocks.sendChatChoice).toHaveBeenLastCalledWith('conv-1', { id: 'o1', label: 'Login UI · Cần làm', kind: 'TARGET' }, 'v2', { kind: 'BOARD', boardId: 'b1' });
    board.unmount();
    mocks.sendChatChoice.mockClear();
    mocks.sendChatMessage.mockResolvedValue(withClarify('conv-2'));
    renderAt('/home'); await openPanel();
    await clickAsync(within(panel()).getByRole('button', { name: 'Hội thoại mới' }));
    await askQuestion('Chuyển Login sang Đang làm');
    await clickAsync(within(panel()).getByRole('button', { name: 'Login UI · Cần làm' }));
    expect(mocks.sendChatChoice).toHaveBeenLastCalledWith('conv-2', { id: 'o1', label: 'Login UI · Cần làm', kind: 'TARGET' }, 'v2');
  });
});

describe('AssistantPanel: dinh kem tep (nut kep giay)', () => {
  const pick = async (name = 'bao-cao.pdf', size = 1200) => {
    const input = screen.getByLabelText('Chọn tệp để đính kèm') as HTMLInputElement;
    const file = new File([new Uint8Array(size)], name, { type: 'application/pdf' });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
  };
  beforeEach(() => {
    mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2', actions: true });
    mocks.sendChatMessage.mockResolvedValue({ ...reply({ cards: [], blocks: [] }), version: 'v2' });
  });

  it('chi co khi tro ly bat hanh dong; chon tep -> hien chip; gui kem uploadIds roi xoa chip; cau hoi hien ten tep', async () => {
    mocks.uploadChatFile.mockResolvedValue({ id: 'up-1', name: 'bao-cao.pdf', size: 1200 });
    renderAt('/boards/b1'); await openPanel();
    expect(await within(panel()).findByRole('button', { name: 'Đính kèm tệp' })).toBeInTheDocument();
    await pick();
    expect(mocks.uploadChatFile).toHaveBeenCalledTimes(1);
    expect(within(panel()).getByRole('list', { name: 'Tệp chờ gắn' })).toHaveTextContent('bao-cao.pdf');
    await askQuestion('Đính kèm file này vào thẻ Login UI');
    expect(mocks.sendChatMessage).toHaveBeenLastCalledWith({ message: 'Đính kèm file này vào thẻ Login UI', scope: { kind: 'BOARD', boardId: 'b1' }, conversationId: undefined, uploadIds: ['up-1'] }, 'v2');
    expect(within(panel()).queryByRole('list', { name: 'Tệp chờ gắn' })).not.toBeInTheDocument();
    expect(within(panel()).getByText('Tệp đính kèm: bao-cao.pdf')).toBeInTheDocument();
  });

  it('bo tep bang nut x goi huy tep tam; tep qua lon / loi may chu hien thong bao, khong tao chip', async () => {
    mocks.uploadChatFile.mockResolvedValue({ id: 'up-2', name: 'a.pdf', size: 10 });
    mocks.discardChatUpload.mockResolvedValue(undefined);
    renderAt('/boards/b1'); await openPanel();
    await within(panel()).findByRole('button', { name: 'Đính kèm tệp' });
    await pick('a.pdf', 10);
    await clickAsync(within(panel()).getByRole('button', { name: 'Bỏ tệp a.pdf' }));
    expect(mocks.discardChatUpload).toHaveBeenCalledWith('up-2');
    expect(within(panel()).queryByRole('list', { name: 'Tệp chờ gắn' })).not.toBeInTheDocument();
    await pick('lon.pdf', 10 * 1024 * 1024 + 1);
    expect(within(panel()).getByRole('alert')).toHaveTextContent('Tệp quá lớn (tối đa 10MB)');
    expect(mocks.uploadChatFile).toHaveBeenCalledTimes(1);
    mocks.uploadChatFile.mockRejectedValueOnce(httpError(429));
    await pick('b.pdf', 10);
    expect(within(panel()).getByRole('alert')).toHaveTextContent('tải tệp hơi nhiều');
    expect(within(panel()).queryByRole('list', { name: 'Tệp chờ gắn' })).not.toBeInTheDocument();
  });

  it('tro ly chi doc (actions tat): khong co nut kep giay', async () => {
    mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true, engine: 'v2', actions: false });
    renderAt('/home'); await openPanel();
    await within(panel()).findByText(/Trợ lý hiện chỉ đọc dữ liệu/);
    expect(within(panel()).queryByRole('button', { name: 'Đính kèm tệp' })).not.toBeInTheDocument();
  });
});
