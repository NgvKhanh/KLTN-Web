import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProtectedRoute from '../../routes/ProtectedRoute';
import type { ChatReply } from '../../types/chat';
import AssistantButton from './AssistantButton';

// Noi tro ly vao app (CHATBOT_MODULE.md §13): ProtectedRoute THAT gan provider + panel (tren moi
// layout), Header dat nut giua "Tạo mới" va chuong thong bao.

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  fetchChatStatus: vi.fn(),
  sendChatMessage: vi.fn(),
  sendChatChoice: vi.fn(),
  fetchMoreAnswer: vi.fn(),
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, isLoading: false }) }));
vi.mock('../../context/BoardsContext', () => ({
  BoardsProvider: ({ children }: { children: ReactNode }) => children,
  useBoards: () => ({ boards: [] }),
}));
vi.mock('../../context/WorkspacesContext', () => ({
  WorkspacesProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspaces: () => ({ workspaces: [], currentWorkspaceId: null }),
}));
vi.mock('../../lib/api/chat', () => ({
  fetchChatStatus: mocks.fetchChatStatus,
  sendChatMessage: mocks.sendChatMessage,
  sendChatChoice: mocks.sendChatChoice,
  fetchMoreAnswer: mocks.fetchMoreAnswer,
}));

const REPLY: ChatReply = {
  conversationId: 'conv-1',
  understood: { intent: 'MY_TASKS', period: null, focus: 'OPEN', memberName: null, parser: 'RULE' },
  answer: {
    kind: 'ANSWER',
    text: 'Bạn có 0 việc chưa xong.',
    scopeLabel: 'Tính trên 1 bảng bạn xem được.',
    generatedAt: '2026-09-30T03:05:00.000Z',
    facts: [],
    cards: [],
    total: 0,
    page: 1,
    pageSize: 10,
    sections: [],
    ignoredSlots: [],
    notes: [],
    suggestions: [],
  },
};

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>Trang đăng nhập</p>} />
        <Route element={<ProtectedRoute />}>
          <Route
            path="/home"
            element={
              <div>
                <AssistantButton />
                <Link to="/boards/b1">Mở bảng</Link>
              </div>
            }
          />
          <Route
            path="/boards/:boardId"
            element={
              <div>
                <AssistantButton />
                <p>Trang bảng</p>
              </div>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user = null;
  mocks.fetchChatStatus.mockResolvedValue({ llmAvailable: true });
  mocks.sendChatMessage.mockResolvedValue(REPLY);
});

describe('noi tro ly vao app', () => {
  it('da dang nhap: ProtectedRoute gan tro ly - mo panel duoc, hoi thoai con khi doi trang con', async () => {
    mocks.user = { id: 'u1' };
    renderApp('/home');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Trợ lý' }));
    });
    // Khung trợ lý là React.lazy: chunk tải xong mới có hộp thoại
    const panel = await screen.findByRole('dialog', { name: 'Trợ lý công việc' });
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Câu hỏi cho trợ lý' }), { target: { value: 'Việc của tôi?' } });
    await act(async () => {
      fireEvent.click(within(panel).getByRole('button', { name: 'Gửi' }));
    });
    expect(within(panel).getByText('Bạn có 0 việc chưa xong.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Mở bảng' }));
    expect(screen.getByText('Trang bảng')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'Trợ lý công việc' })).getByText('Bạn có 0 việc chưa xong.')).toBeInTheDocument();
  });

  it('chua dang nhap: ve trang dang nhap, khong co tro ly, khong goi API', () => {
    renderApp('/home');
    expect(screen.getByText('Trang đăng nhập')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trợ lý' })).not.toBeInTheDocument();
    expect(mocks.fetchChatStatus).not.toHaveBeenCalled();
  });

  it('thu tu lop: panel (z-[35]) nam TREN lop phu z-30, DUOI moi menu / popover z-40 va modal z-50 (Header, bang, the)', () => {
    const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
    const zOf = (cls: string) => Number(/^z-\[?(\d+)\]?$/.exec(cls)?.[1]);
    const panelZ = read('src/components/assistant/AssistantPanel.tsx').match(/fixed bottom-0 right-0 top-14 (z-\S+)/)?.[1] ?? '';
    expect(panelZ).toBe('z-[35]');
    // Loi tim thay khi thu tren trinh duyet: panel z-40 ve sau che menu tai khoan z-40 -> khong bam duoc "Đăng xuất"
    const headerZ = [...read('src/components/Header.tsx').matchAll(/\bz-(\d+)\b/g)].map((m) => Number(m[1]));
    expect(headerZ.length).toBeGreaterThan(0);
    expect(Math.min(...headerZ)).toBeGreaterThan(zOf(panelZ));
    expect(read('src/components/board/CardModal.tsx')).toMatch(/fixed inset-0 z-50/);
    expect(zOf(panelZ)).toBeLessThan(50);
    expect(zOf(panelZ)).toBeGreaterThan(30);
  });

  it('Header dat nut Trợ lý giua "Tạo mới" va chuong thong bao', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/Header.tsx'), 'utf8');
    const at = (tag: string) => src.indexOf(tag);
    expect(at("import AssistantButton from './assistant/AssistantButton';")).toBeGreaterThan(-1);
    const [create, assistant, bell] = [at('<CreateBoardMenu />'), at('<AssistantButton />'), at('<NotificationBell />')];
    expect(create).toBeGreaterThan(-1);
    expect(create < assistant && assistant < bell).toBe(true);
    // nam lien nhau trong cung cum nut ben phai
    expect(src.slice(create, bell).split('\n').map((l) => l.trim()).filter(Boolean)).toEqual(['<CreateBoardMenu />', '<AssistantButton />']);
  });
});
