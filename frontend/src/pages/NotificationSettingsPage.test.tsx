import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationPreference } from '../lib/api/notification';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), update: vi.fn() }));
vi.mock('../lib/api/notification', () => ({ fetchNotificationPreference: mocks.fetch, updateNotificationPreference: mocks.update }));

import NotificationSettingsPage from './NotificationSettingsPage';

const PREF: NotificationPreference = {
  cardInApp: true,
  cardEmailDigest: true,
  boardInApp: true,
  boardEmailDigest: true,
  dueReminderInApp: true,
  dueReminderEmail: true,
  riskInApp: true,
  riskEmail: true,
  dailyDigestEnabled: false,
};

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.update.mockReset();
  mocks.fetch.mockResolvedValue(PREF);
});

describe('Cài đặt thông báo - nhóm Nguy cơ trễ hạn', () => {
  it('hai công tắc riêng; tắt email chỉ gửi đúng khoá riskEmail', async () => {
    mocks.update.mockResolvedValue({ ...PREF, riskEmail: false });
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);
    const inApp = await screen.findByRole('switch', { name: 'Nguy cơ trễ hạn: thông báo trong ứng dụng' });
    const email = screen.getByRole('switch', { name: 'Nguy cơ trễ hạn: gửi email' });
    expect(inApp).toHaveAttribute('aria-checked', 'true');
    await user.click(email);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ riskEmail: false }));
    expect(screen.getByRole('switch', { name: 'Nguy cơ trễ hạn: gửi email' })).toHaveAttribute('aria-checked', 'false');
  });

  it('lưu lỗi → trả công tắc về trạng thái cũ', async () => {
    mocks.update.mockRejectedValue(new Error('x'));
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);
    await user.click(await screen.findByRole('switch', { name: 'Nguy cơ trễ hạn: thông báo trong ứng dụng' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ riskInApp: false }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Nguy cơ trễ hạn: thông báo trong ứng dụng' })).toHaveAttribute('aria-checked', 'true'));
  });
});
