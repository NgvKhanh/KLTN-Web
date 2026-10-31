import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardDetail } from '../../types/card';

// 2 nguoi cung sua 1 the (khoa lac quan theo truong): luu ma nguoi khac da doi
// truong do -> hop thoai chon giu ban nao, KHONG am tham ghi de.

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Set<(p?: unknown) => void>>();
  return {
    fetchCardDetail: vi.fn(),
    updateCard: vi.fn(),
    socket: {
      on(e: string, fn: (p?: unknown) => void) {
        if (!handlers.has(e)) handlers.set(e, new Set());
        handlers.get(e)!.add(fn);
      },
      off(e: string, fn: (p?: unknown) => void) {
        handlers.get(e)?.delete(fn);
      },
      emit(e: string, p?: unknown) {
        handlers.get(e)?.forEach((fn) => fn(p));
      },
    },
  };
});

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
vi.mock('../../lib/api/customField', () => ({
  fetchBoardCustomFields: vi.fn().mockResolvedValue([]),
  setCardFieldValue: vi.fn(),
}));
vi.mock('../../lib/api/list', () => ({ fetchBoardLists: vi.fn().mockResolvedValue([]) }));
vi.mock('../../lib/api/cardTemplate', () => ({ saveCardAsTemplate: vi.fn() }));
vi.mock('../../context/BoardsContext', () => ({ useBoards: () => ({ boards: [] }) }));

import CardModal from './CardModal';

const card = (over: Partial<CardDetail> = {}): CardDetail => ({
  id: 'c1',
  listId: 'l1',
  title: 'Tieu de goc',
  description: 'Mo ta goc',
  status: 'TODO',
  isDone: false,
  startDate: null,
  dueDate: null,
  storyPoints: null,
  coverColor: null,
  coverImageUrl: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  list: { id: 'l1', name: 'Cot 1', boardId: 'b1', status: null },
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

const conflict409 = (current: Record<string, unknown>) =>
  new AxiosError('conflict', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 409,
    data: {
      success: false,
      code: 'CARD_CONFLICT',
      data: { fields: Object.keys(current), current },
    },
  } as AxiosResponse);

async function openDescEditor() {
  const user = userEvent.setup();
  render(
    <CardModal
      cardId="c1"
      lists={[]}
      boardMembers={[]}
      currentUserId="u1"
      onClose={vi.fn()}
      onChanged={vi.fn()}
    />
  );
  await user.click(await screen.findByText('Mo ta goc'));
  const box = await screen.findByPlaceholderText(/nghiêng/);
  await user.clear(box);
  await user.type(box, 'Ban cua A');
  return { user, box };
}

describe('CardModal - nhieu nguoi cung sua mot the', () => {
  beforeEach(() => {
    mocks.fetchCardDetail.mockReset();
    mocks.updateCard.mockReset();
    mocks.fetchCardDetail.mockResolvedValue(card());
  });

  it('luu mo ta: gui kem gia tri GOC luc bat dau sua', async () => {
    mocks.updateCard.mockResolvedValue({});
    const { user } = await openDescEditor();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocks.updateCard).toHaveBeenCalledTimes(1));
    expect(mocks.updateCard).toHaveBeenCalledWith('c1', {
      description: 'Ban cua A',
      expected: { description: 'Mo ta goc' },
    });
  });

  it('nguoi khac da doi mo ta -> hien hop thoai, KHONG co loi chung chung, chua ghi gi them', async () => {
    mocks.updateCard.mockRejectedValueOnce(conflict409({ description: 'Ban cua B' }));
    const { user } = await openDescEditor();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Ban cua A');
    expect(dialog).toHaveTextContent('Ban cua B');
    expect(screen.queryByText('Thao tác thất bại.')).not.toBeInTheDocument();
    expect(mocks.updateCard).toHaveBeenCalledTimes(1);
  });

  it('"Ghi de" -> gui lai ban cua minh, lay ban moi nhat lam gia tri goc moi', async () => {
    mocks.updateCard
      .mockRejectedValueOnce(conflict409({ description: 'Ban cua B' }))
      .mockResolvedValueOnce({});
    const { user } = await openDescEditor();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await user.click(await screen.findByRole('button', { name: 'Ghi đè bằng bản của tôi' }));

    await waitFor(() => expect(mocks.updateCard).toHaveBeenCalledTimes(2));
    expect(mocks.updateCard).toHaveBeenLastCalledWith('c1', {
      description: 'Ban cua A',
      expected: { description: 'Ban cua B' },
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('"Ghi de" nhung lai co nguoi thu 3 luu -> van hien hop thoai voi ban moi nhat, khong am tham de', async () => {
    mocks.updateCard
      .mockRejectedValueOnce(conflict409({ description: 'Ban cua B' }))
      .mockRejectedValueOnce(conflict409({ description: 'Ban cua C' }));
    const { user } = await openDescEditor();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await user.click(await screen.findByRole('button', { name: 'Ghi đè bằng bản của tôi' }));

    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('Ban cua C'));
    expect(mocks.updateCard).toHaveBeenCalledTimes(2);
  });

  it('"Dung ban moi" -> bo ban cua minh, tai lai the, khong gui them gi', async () => {
    mocks.updateCard.mockRejectedValueOnce(conflict409({ description: 'Ban cua B' }));
    const { user } = await openDescEditor();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    mocks.fetchCardDetail.mockResolvedValue(card({ description: 'Ban cua B' }));
    await user.click(await screen.findByRole('button', { name: 'Dùng bản mới trên thẻ' }));

    expect(await screen.findByText('Ban cua B')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mocks.updateCard).toHaveBeenCalledTimes(1);
  });

  it('"Sua tiep" -> quay lai o soan thao con nguyen noi dung cua minh', async () => {
    mocks.updateCard.mockRejectedValueOnce(conflict409({ description: 'Ban cua B' }));
    const { user } = await openDescEditor();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    mocks.fetchCardDetail.mockResolvedValue(card({ description: 'Ban cua B' }));
    await user.click(await screen.findByRole('button', { name: 'Sửa tiếp' }));

    const box = await screen.findByPlaceholderText(/nghiêng/);
    expect(box).toHaveValue('Ban cua A');

    // Luu lai: goc moi = ban cua B
    mocks.updateCard.mockResolvedValueOnce({});
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocks.updateCard).toHaveBeenCalledTimes(2));
    expect(mocks.updateCard).toHaveBeenLastCalledWith('c1', {
      description: 'Ban cua A',
      expected: { description: 'Ban cua B' },
    });
  });

  it('khong sua gi roi bam Luu -> khong gui gi (khong de ban moi cua nguoi khac bi ghi de bang ban cu)', async () => {
    const user = userEvent.setup();
    render(
      <CardModal
        cardId="c1"
        lists={[]}
        boardMembers={[]}
        currentUserId="u1"
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    );
    await user.click(await screen.findByText('Mo ta goc'));
    await user.click(await screen.findByRole('button', { name: 'Lưu' }));
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('nguoi khac sua luc minh dang go: khong tai lai (giu ban nhap), nhac nhe; huy -> tai lai ngay', async () => {
    const { user } = await openDescEditor();
    const callsBefore = mocks.fetchCardDetail.mock.calls.length;

    mocks.socket.emit('board:lists-changed', { boardId: 'b1' });
    expect(await screen.findByRole('status')).toHaveTextContent('vừa có thay đổi');
    // ban nhap con nguyen, chua tai lai
    expect(screen.getByPlaceholderText(/nghiêng/)).toHaveValue('Ban cua A');
    expect(mocks.fetchCardDetail.mock.calls.length).toBe(callsBefore);

    mocks.fetchCardDetail.mockResolvedValue(card({ description: 'Ban cua B' }));
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(await screen.findByText('Ban cua B')).toBeInTheDocument();
    expect(mocks.fetchCardDetail.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

describe('CardModal - thao tac sua tieu de / mo ta', () => {
  beforeEach(() => {
    mocks.fetchCardDetail.mockReset();
    mocks.updateCard.mockReset();
    mocks.fetchCardDetail.mockResolvedValue(card());
  });

  const renderModal = (onClose = vi.fn()) => {
    render(
      <CardModal
        cardId="c1"
        lists={[]}
        boardMembers={[]}
        currentUserId="u1"
        onClose={onClose}
        onChanged={vi.fn()}
      />
    );
    return onClose;
  };

  it('Esc khi dang go mo ta: chi huy sua, KHONG dong the va khong luu', async () => {
    const user = userEvent.setup();
    const onClose = renderModal();
    await user.click(await screen.findByText('Mo ta goc'));
    const box = await screen.findByPlaceholderText(/nghiêng/);
    await user.type(box, ' them chu');
    await user.keyboard('{Escape}');

    expect(screen.queryByPlaceholderText(/nghiêng/)).not.toBeInTheDocument();
    expect(await screen.findByText('Mo ta goc')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('Esc khi dang go tieu de: huy sua, giu tieu de cu, KHONG dong the va khong luu', async () => {
    const user = userEvent.setup();
    const onClose = renderModal();
    await user.click(await screen.findByRole('heading', { name: 'Tieu de goc' }));
    const box = screen.getAllByRole('textbox')[0];
    await user.clear(box);
    await user.type(box, 'Tieu de dang go do');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('heading', { name: 'Tieu de goc' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('Esc khong dang sua gi: dong the nhu cu', async () => {
    const user = userEvent.setup();
    const onClose = renderModal();
    await screen.findByText('Mo ta goc');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('luu mo ta bi server tu choi (400): hien ly do cu the va mo lai o soan thao voi ban nhap', async () => {
    mocks.updateCard.mockRejectedValueOnce(
      new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 400,
        data: {
          success: false,
          message: 'Du lieu gui len khong hop le',
          errors: [{ field: 'description', message: 'Mo ta qua dai' }],
        },
      } as AxiosResponse)
    );
    const { user } = await openDescEditor();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(await screen.findByText('Mo ta qua dai')).toBeInTheDocument();
    const box = await screen.findByPlaceholderText(/nghiêng/);
    expect(box).toHaveValue('Ban cua A');
  });
});
