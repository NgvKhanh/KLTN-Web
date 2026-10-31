import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarCard, CalendarChecklistItem } from '../lib/api/card';
import CalendarPage from './CalendarPage';

const mocks = vi.hoisted(() => ({
  fetchCalendarCards: vi.fn(),
  updateCard: vi.fn(),
}));

vi.mock('../lib/api/card', () => ({
  fetchCalendarCards: mocks.fetchCalendarCards,
  updateCard: mocks.updateCard,
}));

// Giữa tháng 10/2026, giờ trưa: tránh lệch ngày do múi giờ khi đổi sang ISO
const NOW = new Date(2026, 9, 14, 12, 0, 0);

function dueAt(day: number): string {
  return new Date(2026, 9, day, 9, 0, 0).toISOString();
}

function card(id: string, title: string, day: number, isDone = false): CalendarCard {
  return {
    id,
    title,
    isDone,
    startDate: null,
    dueDate: dueAt(day),
    list: {
      id: 'l1',
      name: 'Đang làm',
      boardId: 'b1',
      board: { id: 'b1', name: 'Talk show', color: '#4f46e5' },
    },
  };
}

function checkItem(id: string, content: string, day: number): CalendarChecklistItem {
  return {
    id,
    content,
    isDone: false,
    dueDate: dueAt(day),
    checklist: { card: { id: 'c-parent', title: 'Thẻ mẹ', list: card('x', 'x', day).list } },
  };
}

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderCalendar() {
  return render(
    <MemoryRouter initialEntries={['/calendar']}>
      <Where />
      <Routes>
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/boards/:boardId" element={<p>Trang bảng</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  // Chỉ giả ngày hiện tại; hẹn giờ vẫn thật để userEvent và waitFor chạy bình thường
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  mocks.fetchCalendarCards.mockReset();
  mocks.updateCard.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CalendarPage', () => {
  it('marks today so it can be told apart from other days', async () => {
    mocks.fetchCalendarCards.mockResolvedValue({ cards: [], checklistItems: [] });
    renderCalendar();
    await waitFor(() => expect(mocks.fetchCalendarCards).toHaveBeenCalled());

    const today = document.querySelector('[aria-current="date"]');
    expect(today).not.toBeNull();
    expect(today).toHaveTextContent('14');
    expect(today).toHaveClass('bg-primary', 'text-white');
    // Chỉ một ngày được đánh dấu
    expect(document.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
  });

  it('opens a dialog with every job of the day when "+N nữa" is pressed', async () => {
    const user = userEvent.setup();
    mocks.fetchCalendarCards.mockResolvedValue({
      cards: [
        card('c1', 'Việc một', 14),
        card('c2', 'Việc hai', 14),
        card('c3', 'Việc ba', 14),
        card('c4', 'Việc bốn', 14),
        card('c5', 'Việc năm', 14, true),
      ],
      checklistItems: [checkItem('i1', 'Gọi nhà tài trợ', 14)],
    });
    renderCalendar();

    const more = await screen.findByRole('button', { name: 'Xem thêm 3 việc ngày 14/10' });
    expect(more).toHaveTextContent('+3 nữa');
    // Ô chỉ hiện 3 dòng; việc thứ 4 trở đi chưa có trên lịch
    expect(screen.queryByText('Việc bốn')).not.toBeInTheDocument();

    await user.click(more);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Hôm nay · 6 việc')).toBeInTheDocument();
    for (const title of ['Việc một', 'Việc hai', 'Việc ba', 'Việc bốn', 'Việc năm', 'Gọi nhà tài trợ']) {
      expect(within(dialog).getByText(title)).toBeInTheDocument();
    }
    // Mỗi thẻ ghi rõ nó thuộc bảng nào, cột nào
    expect(within(dialog).getAllByText('Talk show · Đang làm')).toHaveLength(5);
  });

  it('counts cards and checklist items together, so nothing hidden is miscounted', async () => {
    mocks.fetchCalendarCards.mockResolvedValue({
      cards: [card('c1', 'Một', 20), card('c2', 'Hai', 20)],
      checklistItems: [checkItem('i1', 'Mục một', 20)],
    });
    renderCalendar();
    // 3 việc vừa đủ 3 dòng: không có nút "+N nữa" thừa
    await screen.findByText('Mục một');
    expect(screen.queryByRole('button', { name: /Xem thêm/ })).not.toBeInTheDocument();
  });

  it('opens the same dialog from the day number, and not for an empty day', async () => {
    const user = userEvent.setup();
    mocks.fetchCalendarCards.mockResolvedValue({
      cards: [card('c1', 'Chỉ một việc', 20)],
      checklistItems: [],
    });
    renderCalendar();
    await screen.findByText('Chỉ một việc');

    await user.click(screen.getByRole('button', { name: 'Xem 1 việc ngày 20/10' }));
    expect(within(screen.getByRole('dialog')).getByText('Chỉ một việc')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ngày 21\/10/ })).not.toBeInTheDocument();
  });

  it('closes the dialog on Escape and from the close button', async () => {
    const user = userEvent.setup();
    mocks.fetchCalendarCards.mockResolvedValue({
      cards: [card('c1', 'Một', 20)],
      checklistItems: [],
    });
    renderCalendar();
    await screen.findByText('Một');

    await user.click(screen.getByRole('button', { name: 'Xem 1 việc ngày 20/10' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Xem 1 việc ngày 20/10' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not close right away when the opening click was a double-click that lands on the backdrop', async () => {
    const user = userEvent.setup();
    mocks.fetchCalendarCards.mockResolvedValue({
      cards: [card('c1', 'Một', 20)],
      checklistItems: [],
    });
    renderCalendar();
    await screen.findByText('Một');

    await user.click(screen.getByRole('button', { name: 'Xem 1 việc ngày 20/10' }));
    const backdrop = screen.getByRole('dialog').parentElement!;
    // Lần bấm thứ hai của cú bấm đúp: ngay sau khi hộp mở
    fireEvent.mouseDown(backdrop);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Người dùng chủ ý bấm ra ngoài sau đó: đóng bình thường
    vi.setSystemTime(Date.now() + 1000);
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('goes to the card on its board when a job in the dialog is chosen', async () => {
    const user = userEvent.setup();
    mocks.fetchCalendarCards.mockResolvedValue({
      cards: [card('c1', 'Một', 20)],
      checklistItems: [],
    });
    renderCalendar();
    await screen.findByText('Một');

    await user.click(screen.getByRole('button', { name: 'Xem 1 việc ngày 20/10' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Một/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/boards/b1?card=c1');
  });
});
