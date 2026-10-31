import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../types/auth';
import ProfilePage from './ProfilePage';

// Trang Hồ sơ: 3 tab (Thông tin / Kỹ năng & CV / Tùy chọn), sửa tên + ảnh đại diện, chọn giao diện.

const USER: User = {
  id: 'u1',
  email: 'long@team.local',
  name: 'Nguyễn Minh Long',
  avatarUrl: null,
  emailVerifiedAt: '2026-05-12T00:00:00.000Z',
  createdAt: '2026-05-12T00:00:00.000Z',
};

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
  setTheme: vi.fn(),
  updateProfile: vi.fn(),
  uploadAvatar: vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: USER, updateUser: mocks.updateUser }),
}));
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'system', setTheme: mocks.setTheme }),
}));
vi.mock('../lib/api/auth', () => ({
  updateProfile: mocks.updateProfile,
  uploadAvatar: mocks.uploadAvatar,
}));
// Tab Kỹ năng & CV có test riêng (DeclaredProfileSection.test.tsx) và tự gọi API
vi.mock('../components/DeclaredProfileSection', () => ({
  default: () => <p>NỘI DUNG KỸ NĂNG</p>,
}));

beforeEach(() => {
  vi.resetAllMocks();
});

function renderPage() {
  const u = userEvent.setup();
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>
  );
  return u;
}

const nameInput = () => screen.getByLabelText('Tên hiển thị');
const saveBtn = () => screen.getByRole('button', { name: 'Lưu thay đổi' });

describe('ProfilePage', () => {
  it('mặc định ở tab Thông tin: tiêu đề, email đã xác minh, nút đổi mật khẩu; không còn số thống kê trang trí', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Hồ sơ' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Thông tin' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('long@team.local')).toBeInTheDocument();
    expect(screen.getByText('Đã xác minh')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Đổi mật khẩu' })).toHaveAttribute('href', '/settings/password');
    expect(screen.queryByText('Bảng tham gia')).not.toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).not.toBeInTheDocument();
  });

  it('sửa tên: hiện Hoàn tác, Lưu gọi API với tên đã cắt khoảng trắng và cập nhật người dùng', async () => {
    mocks.updateProfile.mockResolvedValue({ ...USER, name: 'Long Nguyễn' });
    const u = renderPage();
    await u.clear(nameInput());
    await u.type(nameInput(), '  Long Nguyễn ');
    expect(screen.getByRole('button', { name: 'Hoàn tác' })).toBeInTheDocument();

    await u.click(saveBtn());
    expect(mocks.updateProfile).toHaveBeenCalledWith({ name: 'Long Nguyễn', avatarUrl: null });
    expect(mocks.updateUser).toHaveBeenCalledWith({ ...USER, name: 'Long Nguyễn' });
    expect(await screen.findByRole('status')).toHaveTextContent('Đã lưu.');
  });

  it('Hoàn tác trả lại tên cũ; lưu lỗi thì báo lỗi và giữ chữ đã sửa', async () => {
    const u = renderPage();
    await u.type(nameInput(), ' X');
    await u.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(nameInput()).toHaveValue('Nguyễn Minh Long');

    mocks.updateProfile.mockRejectedValue(new Error('mất mạng'));
    await u.type(nameInput(), ' Y');
    await u.click(saveBtn());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(nameInput()).toHaveValue('Nguyễn Minh Long Y');
  });

  it('ảnh sai định dạng hoặc quá 2MB bị chặn ngay, không gọi API; ảnh hợp lệ thì tải lên', async () => {
    mocks.uploadAvatar.mockResolvedValue({ ...USER, avatarUrl: '/uploads/avatars/a.png' });
    renderPage();
    const picker = screen.getByLabelText('Chọn ảnh đại diện');

    fireEvent.change(picker, { target: { files: [new File(['x'], 'cv.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('tối đa 2MB');
    expect(mocks.uploadAvatar).not.toHaveBeenCalled();

    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'to.png', { type: 'image/png' });
    fireEvent.change(picker, { target: { files: [big] } });
    expect(mocks.uploadAvatar).not.toHaveBeenCalled();

    const ok = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(picker, { target: { files: [ok] } });
    expect(await screen.findByText('Đã đổi ảnh đại diện.')).toBeInTheDocument();
    expect(mocks.uploadAvatar).toHaveBeenCalledWith(ok);
    expect(screen.getByRole('button', { name: 'Xoá ảnh' })).toBeInTheDocument();
  });

  it('"Dùng liên kết ảnh" mở ô dán liên kết; đổi liên kết thì được tính là thay đổi chưa lưu', async () => {
    const u = renderPage();
    const urlBox = screen.getByLabelText('Liên kết ảnh đại diện');
    expect(urlBox).not.toBeVisible();
    await u.click(screen.getByRole('button', { name: 'Dùng liên kết ảnh' }));
    expect(urlBox).toBeVisible();
    await u.type(urlBox, 'https://example.com/a.jpg');
    expect(saveBtn()).toBeEnabled();
  });

  it('chuyển tab bằng chuột và phím mũi tên; tab ẩn vẫn giữ trong trang (không mất chữ đang gõ)', async () => {
    const u = renderPage();
    await u.type(nameInput(), ' Z');
    await u.click(screen.getByRole('tab', { name: 'Kỹ năng & CV' }));
    expect(screen.getByText('NỘI DUNG KỸ NĂNG')).toBeVisible();
    expect(nameInput()).not.toBeVisible();

    await u.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Tùy chọn' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Tùy chọn' })).toHaveFocus();

    await u.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Thông tin' })).toHaveAttribute('aria-selected', 'true');
    expect(nameInput()).toHaveValue('Nguyễn Minh Long Z');
  });

  it('tab Tùy chọn: chọn giao diện Tối gọi setTheme; có lối tới cài đặt thông báo', async () => {
    const u = renderPage();
    await u.click(screen.getByRole('tab', { name: 'Tùy chọn' }));
    expect(screen.getByRole('radio', { name: 'Hệ thống' })).toHaveAttribute('aria-checked', 'true');
    await u.click(screen.getByRole('radio', { name: 'Tối' }));
    expect(mocks.setTheme).toHaveBeenCalledWith('dark');
    expect(screen.getByRole('link', { name: 'Cài đặt thông báo' })).toHaveAttribute('href', '/settings/notifications');
  });
});
