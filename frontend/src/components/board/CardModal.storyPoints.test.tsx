import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardDetail } from '../../types/card';

// O "Do phuc tap" (story point) trong hop chi tiet the. Nguy co tre han KHONG hien o giao dien (user chot 28/10: chi thong bao +
// email, RISK_MODULE.md §11).

const mocks = vi.hoisted(() => ({
  fetchCardDetail: vi.fn(),
  updateCard: vi.fn(),
  socket: { on() {}, off() {}, emit() {} },
}));

vi.mock('../../lib/axios', () => ({ api: {} }));
vi.mock('../../lib/socket', () => ({ socket: mocks.socket }));
vi.mock('../../lib/api/card', async (importActual) => {
  const actual = await importActual<typeof import('../../lib/api/card')>();
  return {
    ...actual,
    fetchCardDetail: mocks.fetchCardDetail,
    updateCard: mocks.updateCard,
    fetchBoardLabels: vi.fn().mockResolvedValue([]),
    fetchCardReminders: vi.fn().mockResolvedValue([]),
  };
});
vi.mock('../../lib/api/customField', () => ({ fetchBoardCustomFields: vi.fn().mockResolvedValue([]), setCardFieldValue: vi.fn() }));
vi.mock('../../lib/api/list', () => ({ fetchBoardLists: vi.fn().mockResolvedValue([]) }));
vi.mock('../../lib/api/cardTemplate', () => ({ saveCardAsTemplate: vi.fn() }));
vi.mock('../../context/BoardsContext', () => ({ useBoards: () => ({ boards: [] }) }));

import CardModal from './CardModal';

const card = (over: Partial<CardDetail> = {}): CardDetail => ({
  id: 'c1',
  listId: 'l1',
  title: 'Làm slide',
  description: null,
  status: 'TODO',
  isDone: false,
  startDate: null,
  dueDate: '2026-11-01T10:00:00.000Z',
  storyPoints: null,
  coverColor: null,
  coverImageUrl: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  list: { id: 'l1', name: 'Cột 1', boardId: 'b1', status: null },
  members: [],
  labels: [],
  checklists: [],
  comments: [],
  attachments: [],
  activities: [],
  isWatching: false,
  fieldValues: [],
  ...over,
});

const open = (readOnly = false) =>
  render(<CardModal cardId="c1" lists={[]} boardMembers={[]} currentUserId="u1" readOnly={readOnly} onClose={vi.fn()} onChanged={vi.fn()} />);

beforeEach(() => {
  mocks.fetchCardDetail.mockReset();
  mocks.updateCard.mockReset();
});

describe('CardModal - độ phức tạp', () => {
  it('chọn độ phức tạp → updateCard(storyPoints), chọn "Chưa đặt" → null', async () => {
    mocks.fetchCardDetail.mockResolvedValueOnce(card()).mockResolvedValue(card({ storyPoints: 5 }));
    mocks.updateCard.mockResolvedValue({});
    const user = userEvent.setup();
    open();
    const select = await screen.findByLabelText('Độ phức tạp');
    expect(select).toHaveValue('');
    await user.selectOptions(select, '5');
    await waitFor(() => expect(mocks.updateCard).toHaveBeenCalledWith('c1', { storyPoints: 5 }));
    await waitFor(() => expect(screen.getByLabelText('Độ phức tạp')).toHaveValue('5'));
    mocks.fetchCardDetail.mockResolvedValue(card());
    await user.selectOptions(screen.getByLabelText('Độ phức tạp'), '');
    await waitFor(() => expect(mocks.updateCard).toHaveBeenLastCalledWith('c1', { storyPoints: null }));
    expect([...(screen.getByLabelText('Độ phức tạp') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', '1', '2', '3', '5', '8']);
  });

  it('chỉ xem: không có ô chọn; có điểm thì hiện chữ', async () => {
    mocks.fetchCardDetail.mockResolvedValue(card({ storyPoints: 8 }));
    open(true);
    expect(await screen.findByText('8 điểm')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Độ phức tạp' })).not.toBeInTheDocument();
  });

  it('không còn mục Nguy cơ trễ hạn trong thẻ (chỉ báo qua thông báo + email)', async () => {
    mocks.fetchCardDetail.mockResolvedValue(card());
    open();
    await screen.findByLabelText('Độ phức tạp');
    expect(screen.queryByText('Nguy cơ trễ hạn')).not.toBeInTheDocument();
    expect(screen.queryByText(/Khả năng trễ hạn/)).not.toBeInTheDocument();
  });
});
