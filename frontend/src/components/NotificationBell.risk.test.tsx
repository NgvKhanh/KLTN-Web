import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppNotification } from '../types/notification';

// vi.mock duoc keo len dau tep -> du lieu mau phai nam trong vi.hoisted
const { RISK } = vi.hoisted(() => {
  const RISK: AppNotification = {
    id: 'n1',
    type: 'card.risk.warning',
    boardId: 'b1',
    cardId: 'c1',
    workspaceId: null,
    data: { cardTitle: 'Làm slide', kind: 'overdue', level: 'CRITICAL', score: '100' },
    isRead: false,
    createdAt: new Date().toISOString(),
    actor: { id: 'u1', name: 'Tôi', avatarUrl: null },
  };
  return { RISK };
});

vi.mock('../lib/api/notification', () => ({
  fetchNotifications: vi.fn().mockResolvedValue([
    RISK,
    { ...RISK, id: 'n2', cardId: 'c2', data: { cardTitle: 'Đặt phòng', kind: 'risk', level: 'CRITICAL', score: '84' } },
    // Thong bao cu (truoc 30/10) chua co kind: suy tu luc bao so voi han
    { ...RISK, id: 'n3', cardId: 'c3', createdAt: '2026-10-20T10:00:00.000Z', data: { cardTitle: 'In vé', level: 'CRITICAL', score: '100', dueDate: '2026-10-19T10:00:00.000Z' } },
    { ...RISK, id: 'n4', cardId: 'c4', createdAt: '2026-10-20T10:00:00.000Z', data: { cardTitle: 'Thuê loa', level: 'WARNING', score: '58', dueDate: '2026-10-25T10:00:00.000Z' } },
  ]),
  fetchUnreadCount: vi.fn().mockResolvedValue(4),
  markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
  markNotificationRead: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/socket', () => ({ socket: { on() {}, off() {} } }));

import NotificationBell from './NotificationBell';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

describe('NotificationBell - cảnh báo nguy cơ trễ hạn', () => {
  it('chỉ hai loại câu "có nguy cơ trễ hạn" / "đã trễ hạn" — không mức, không phần trăm; bấm vào mở đúng thẻ', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/home']}>
        <NotificationBell />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    );
    await user.click(screen.getByRole('button', { name: 'Thông báo' }));
    expect(await screen.findByText('Thẻ "Làm slide" đã trễ hạn')).toBeInTheDocument();
    expect(screen.getByText('Thẻ "Đặt phòng" có nguy cơ trễ hạn')).toBeInTheDocument();
    expect(screen.getByText('Thẻ "In vé" đã trễ hạn')).toBeInTheDocument();
    expect(screen.getByText('Thẻ "Thuê loa" có nguy cơ trễ hạn')).toBeInTheDocument();
    expect(screen.queryByText(/Cảnh báo|Nguy cấp|\d+%/)).not.toBeInTheDocument();
    await user.click(screen.getByText('Thẻ "Làm slide" đã trễ hạn'));
    expect(screen.getByTestId('where')).toHaveTextContent('/boards/b1?card=c1');
  });
});
