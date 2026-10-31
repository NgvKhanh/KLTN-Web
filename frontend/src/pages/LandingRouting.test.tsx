import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../types/auth';
import App from '../App';

const mocks = vi.hoisted(() => ({
  user: null as User | null,
  isLoading: false,
  login: vi.fn(),
  register: vi.fn(),
  workspacesMounted: vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: mocks.user,
    isLoading: mocks.isLoading,
    login: mocks.login,
    register: mocks.register,
  }),
}));
vi.mock('../context/BoardsContext', () => ({
  BoardsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../context/WorkspacesContext', () => ({
  WorkspacesProvider: ({ children }: { children: ReactNode }) => {
    mocks.workspacesMounted();
    return children;
  },
}));
vi.mock('../layouts/MainLayout', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: Outlet };
});
vi.mock('../layouts/BoardViewLayout', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: Outlet };
});
vi.mock('../pages/HomePage', () => ({ default: () => <h1>Danh sách bảng của bạn</h1> }));
vi.mock('../pages/BoardPage', () => ({ default: () => <h1>Bảng đang mở</h1> }));
vi.mock('../pages/JoinBoardPage', () => ({
  default: function MockJoinBoardPage() {
    return <h1>Lời mời {useParams().token}</h1>;
  },
}));
vi.mock('../pages/PublicBoardPage', () => ({
  default: function MockPublicBoardPage() {
    return <h1>Bảng công khai {useParams().boardId}</h1>;
  },
}));
vi.mock('../components/auth/GoogleAuthButton', () => ({ default: () => null }));

const USER: User = {
  id: 'u1',
  name: 'Minh Anh',
  email: 'anh@example.com',
  avatarUrl: null,
  emailVerifiedAt: '2026-09-01',
  createdAt: '2026-09-01',
};

function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function appAt(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Location />
    </MemoryRouter>
  );
}

function open(path = '/') {
  return render(appAt(path));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = null;
  mocks.isLoading = false;
  mocks.login.mockImplementation(async () => {
    mocks.user = USER;
  });
  mocks.register.mockImplementation(async () => {
    mocks.user = USER;
  });
});

describe('Landing page and workspace entry', () => {
  it('keeps registration as the guest CTA while the session check is pending', async () => {
    mocks.isLoading = true;
    open();
    expect(await screen.findByRole('link', { name: 'Bắt đầu ngay' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'Tạo tài khoản' })).toHaveAttribute('href', '/register');
    fireEvent.click(screen.getByRole('link', { name: 'Bắt đầu ngay' }));
    // Chuyen trang qua startTransition: vi tri chi doi sau khi trang (lazy) tai xong
    expect(await screen.findByRole('heading', { name: 'Tạo tài khoản' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/register');
  });

  it('closes the mobile menu outside and returns focus to its trigger on Escape', async () => {
    open();
    const trigger = await screen.findByRole('button', { name: 'Mở menu' });
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('heading', { level: 1 }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('navigation', { name: 'Điều hướng trên điện thoại' })
    ).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('waits for the session, then shows the 404 page for a member without changing the address', async () => {
    mocks.isLoading = true;
    const view = open('/mistyped-path');
    expect(screen.getByText('Đang kiểm tra đăng nhập…')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('location')).toHaveTextContent('/mistyped-path');
    mocks.user = USER;
    mocks.isLoading = false;
    view.rerender(appAt('/mistyped-path'));
    expect(await screen.findByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument();
    expect(screen.getByText('/mistyped-path', { selector: 'code' })).toBeInTheDocument();
    // Dia chi khong bi doi sang /boards
    expect(screen.getByTestId('location')).toHaveTextContent('/mistyped-path');
    fireEvent.click(screen.getByRole('link', { name: 'Về danh sách bảng' }));
    expect(await screen.findByRole('heading', { name: 'Danh sách bảng của bạn' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/boards');
  });

  it('shows a standalone 404 page to guests with a way back to the landing', async () => {
    open('/mistyped-path');
    expect(await screen.findByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/mistyped-path');
    // Khong mount du lieu khong gian / bang cho khach
    expect(mocks.workspacesMounted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: 'Về trang chủ' }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Quản lý công việc nhóm trên bảng Kanban');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });

  it('shows the public landing without mounting workspace data providers', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Quản lý công việc nhóm trên bảng Kanban');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    expect(screen.getByRole('link', { name: 'Bắt đầu ngay' })).toHaveAttribute('href', '/register');
    expect(mocks.workspacesMounted).not.toHaveBeenCalled();
  });

  it('keeps the landing for signed-in users and opens their boards from its CTA', async () => {
    mocks.user = USER;
    open();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Quản lý công việc nhóm trên bảng Kanban');
    fireEvent.click(screen.getAllByRole('link', { name: 'Mở TaskFlow' })[0]);
    expect(
      await screen.findByRole('heading', { name: 'Danh sách bảng của bạn' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/boards');
  });

  it('lists the main features and the FAQ, both reachable from the header', async () => {
    open();
    const features = (await screen.findByRole('heading', { name: 'Tính năng chính' })).closest('section') as HTMLElement;
    expect(within(features).getAllByRole('article')).toHaveLength(6);
    expect(within(features).getByRole('heading', { name: 'Trợ lý hỏi đáp' })).toBeInTheDocument();
    const faq = screen.getByRole('heading', { name: 'Câu hỏi thường gặp' }).closest('section') as HTMLElement;
    expect(faq).toHaveAttribute('id', 'cau-hoi');
    expect(within(faq).getByText('Không dùng AI có được không?')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Điều hướng giới thiệu' });
    expect(within(nav).getByRole('link', { name: 'Tính năng' })).toHaveAttribute('href', '#tinh-nang');
    expect(within(nav).getByRole('link', { name: 'Câu hỏi thường gặp' })).toHaveAttribute('href', '#cau-hoi');
  });

  it('lets visitors switch the board preview between Kanban and calendar', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Lịch' }));
    expect(
      screen.getByRole('group', { name: 'Lịch công việc minh họa tháng 10' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bảng Kanban' }));
    expect(screen.getByRole('group', { name: 'Bảng Kanban minh họa' })).toBeInTheDocument();
  });

  it('sends a regular login into the workspace instead of back to the landing', async () => {
    open('/login');
    fireEvent.change(await screen.findByPlaceholderText('email@example.com'), {
      target: { value: USER.email },
    });
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="password"]')!, {
      target: { value: 'sample-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(
      await screen.findByRole('heading', { name: 'Danh sách bảng của bạn' })
    ).toBeInTheDocument();
    expect(mocks.login).toHaveBeenCalledWith(USER.email, 'sample-password');
  });

  it('sends a new registration into the workspace', async () => {
    open('/register');
    fireEvent.change(await screen.findByPlaceholderText('Nguyễn Văn A'), { target: { value: USER.name } });
    fireEvent.change(screen.getByPlaceholderText('email@example.com'), {
      target: { value: USER.email },
    });
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="password"]')!, {
      target: { value: 'sample-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng ký' }));
    expect(
      await screen.findByRole('heading', { name: 'Danh sách bảng của bạn' })
    ).toBeInTheDocument();
    expect(mocks.register).toHaveBeenCalledWith(USER.name, USER.email, 'sample-password');
  });

  it('requires login for the boards list and returns to an invitation after login', async () => {
    const first = open('/boards');
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument();
    first.unmount();
    open('/join/invite-token?source=email');
    fireEvent.change(await screen.findByPlaceholderText('email@example.com'), {
      target: { value: USER.email },
    });
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="password"]')!, {
      target: { value: 'sample-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/join/invite-token?source=email')
    );
    expect(await screen.findByRole('heading', { name: 'Lời mời invite-token' })).toBeInTheDocument();
  });

  it('preserves direct board links for visitors and members', async () => {
    const guest = open('/boards/board-1');
    expect(await screen.findByRole('heading', { name: 'Bảng công khai board-1' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/public/boards/board-1');
    guest.unmount();
    mocks.user = USER;
    open('/boards/board-1');
    expect(await screen.findByRole('heading', { name: 'Bảng đang mở' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/boards\/board-1$/);
  });
});
