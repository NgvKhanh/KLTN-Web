import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountMenu } from './Header';

// Menu tài khoản (ảnh đại diện góc phải Header): điều hướng, đánh dấu trang hiện tại,
// chọn giao diện một chạm, đóng bằng Esc / bấm ra ngoài, đăng xuất.

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  setTheme: vi.fn(),
  theme: 'light' as 'light' | 'dark' | 'system',
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Nguyễn Minh Long', email: 'long@team.local', avatarUrl: null },
    logout: mocks.logout,
  }),
}));
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mocks.theme, setTheme: mocks.setTheme }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.theme = 'light';
  mocks.logout.mockResolvedValue(undefined);
});

function renderMenu(path = '/boards') {
  const user = userEvent.setup();
  const page = (name: string) => <p>TRANG {name}</p>;
  render(
    <MemoryRouter initialEntries={[path]}>
      <AccountMenu />
      <Routes>
        <Route path="/" element={page('CHỦ')} />
        <Route path="/boards" element={page('BẢNG')} />
        <Route path="/my-cards" element={page('THẺ')} />
        <Route path="/settings/profile" element={page('HỒ SƠ')} />
      </Routes>
    </MemoryRouter>
  );
  return user;
}

const trigger = () => screen.getByRole('button', { name: 'Tài khoản' });
const menuItem = (name: string) => screen.queryByRole('button', { name });

describe('Header - menu tài khoản', () => {
  it('mở bằng nút ảnh đại diện, hiện tên + email; chọn mục thì chuyển trang và đóng menu', async () => {
    const user = renderMenu();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(menuItem('Hồ sơ')).not.toBeInTheDocument();

    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Nguyễn Minh Long')).toBeInTheDocument();
    expect(screen.getByText('long@team.local')).toBeInTheDocument();

    await user.click(menuItem('Thẻ của tôi')!);
    expect(screen.getByText('TRANG THẺ')).toBeInTheDocument();
    expect(menuItem('Hồ sơ')).not.toBeInTheDocument();
  });

  it('đánh dấu mục ứng với trang đang mở (aria-current), các mục khác không', async () => {
    const user = renderMenu('/settings/profile');
    await user.click(trigger());
    expect(menuItem('Hồ sơ')).toHaveAttribute('aria-current', 'page');
    expect(menuItem('Đổi mật khẩu')).not.toHaveAttribute('aria-current');
    expect(menuItem('Thẻ của tôi')).not.toHaveAttribute('aria-current');
  });

  it('giao diện: 3 lựa chọn hiện sẵn, đúng lựa chọn hiện tại được chọn; bấm "Tối" gọi setTheme và menu vẫn mở', async () => {
    mocks.theme = 'system';
    const user = renderMenu();
    await user.click(trigger());

    const group = screen.getByRole('radiogroup', { name: 'Giao diện' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Hệ thống' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Sáng' })).toHaveAttribute('aria-checked', 'false');

    await user.click(screen.getByRole('radio', { name: 'Tối' }));
    expect(mocks.setTheme).toHaveBeenCalledWith('dark');
    expect(menuItem('Hồ sơ')).toBeInTheDocument();
  });

  it('Esc đóng menu và trả focus về nút ảnh đại diện; bấm ra ngoài cũng đóng', async () => {
    const user = renderMenu();
    await user.click(trigger());
    await user.keyboard('{Escape}');
    expect(menuItem('Hồ sơ')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();

    await user.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(menuItem('Hồ sơ')).not.toBeInTheDocument();
  });

  it('đăng xuất: nút màu đỏ (không lẫn lớp màu xám), gọi logout rồi về trang chủ', async () => {
    const user = renderMenu();
    await user.click(trigger());
    const btn = menuItem('Đăng xuất')!;
    expect(btn.className).toMatch(/text-red-600/);
    expect(btn.className).not.toMatch(/text-slate-/);

    await user.click(btn);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('TRANG CHỦ')).toBeInTheDocument();
  });

  it('gọi API đăng xuất bị lỗi vẫn rời về trang chủ (phiên ở máy đã xoá)', async () => {
    mocks.logout.mockRejectedValue(new Error('mất mạng'));
    const user = renderMenu();
    await user.click(trigger());
    await user.click(menuItem('Đăng xuất')!);
    expect(await screen.findByText('TRANG CHỦ')).toBeInTheDocument();
  });
});
