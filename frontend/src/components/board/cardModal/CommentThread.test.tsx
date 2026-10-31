import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BoardMember } from '../../../types/board';
import CommentThread, { type ThreadItem } from './CommentThread';

// 1 luồng bình luận: gốc + câu trả lời thụt lề, nút "Trả lời" mở ô nhập có sẵn "@Tên ",
// Esc chỉ huỷ ô trả lời (không đóng cả thẻ), gốc đã xoá hiện "Bình luận đã bị xoá".

const user = (id: string, name: string) => ({ id, name, avatarUrl: null });
const item = (id: string, text: string, by: ReturnType<typeof user>, parentId: string | null = null): ThreadItem => ({
  id,
  parentId,
  text,
  createdAt: '2026-10-04T10:00:00.000Z',
  user: by,
});

const LONG = user('u-long', 'Nguyễn Minh Long');
const MAI = user('u-mai', 'Trần Thị Mai');
const MEMBERS = [LONG, MAI].map(
  (u) => ({ id: `m-${u.id}`, boardId: 'b1', userId: u.id, role: 'MEMBER', user: u }) as BoardMember
);

function renderThread(
  over: Partial<Parameters<typeof CommentThread>[0]> = {},
  thread = {
    root: item('root', 'Ai làm phần đăng nhập?', LONG),
    replies: [item('r1', 'Để mình làm', MAI, 'root')],
  }
) {
  const onReply = vi.fn().mockResolvedValue(true);
  const onDelete = vi.fn();
  const u = userEvent.setup();
  render(
    <ul>
      <CommentThread
        thread={thread}
        currentUserId={LONG.id}
        boardMembers={MEMBERS}
        onReply={onReply}
        onDelete={onDelete}
        {...over}
      />
    </ul>
  );
  return { u, onReply, onDelete };
}

const replyBox = () => screen.queryByRole('textbox', { name: 'Viết câu trả lời...' });

describe('CommentThread', () => {
  it('hiện gốc và câu trả lời trong danh sách "Các câu trả lời"; chỉ bình luận của mình có nút Xoá', () => {
    renderThread();
    expect(screen.getByText('Ai làm phần đăng nhập?')).toBeInTheDocument();
    const replies = screen.getByRole('list', { name: 'Các câu trả lời' });
    expect(within(replies).getByText('Để mình làm')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Trả lời' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Xoá' })).toHaveLength(1); // chỉ gốc của Long
  });

  it('bấm "Trả lời" ở câu trả lời của người khác -> ô nhập có sẵn "@Tên ", gửi đúng id được trả lời rồi đóng ô', async () => {
    const { u, onReply } = renderThread();
    const replies = screen.getByRole('list', { name: 'Các câu trả lời' });
    await u.click(within(replies).getByRole('button', { name: 'Trả lời' }));

    const box = replyBox()!;
    expect(box).toHaveValue('@Trần Thị Mai ');
    expect(box).toHaveFocus();
    await u.type(box, 'cảm ơn nhé');
    await u.click(screen.getByRole('button', { name: 'Gửi' }));

    expect(onReply).toHaveBeenCalledWith('r1', '@Trần Thị Mai cảm ơn nhé');
    expect(replyBox()).not.toBeInTheDocument();
  });

  it('trả lời chính bình luận của mình thì không tự nhắc tên mình', async () => {
    const { u } = renderThread();
    await u.click(screen.getAllByRole('button', { name: 'Trả lời' })[0]!); // gốc của Long (chính mình)
    expect(replyBox()).toHaveValue('');
  });

  it('gửi thất bại -> ô trả lời vẫn mở và giữ nguyên chữ đã gõ', async () => {
    const { u, onReply } = renderThread();
    onReply.mockResolvedValue(false);
    await u.click(screen.getAllByRole('button', { name: 'Trả lời' })[1]!);
    await u.type(replyBox()!, 'thử lại');
    await u.click(screen.getByRole('button', { name: 'Gửi' }));
    expect(replyBox()).toHaveValue('@Trần Thị Mai thử lại');
  });

  it('Esc chỉ huỷ ô trả lời, không lan tới trình nghe Esc của cả thẻ', async () => {
    const closeCard = vi.fn();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeCard();
    document.addEventListener('keydown', onKey);
    try {
      const { u } = renderThread();
      await u.click(screen.getAllByRole('button', { name: 'Trả lời' })[1]!);
      await u.keyboard('{Escape}');
      expect(replyBox()).not.toBeInTheDocument();
      expect(closeCard).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', onKey);
    }
  });

  it('gõ @ trong ô trả lời -> gợi ý thành viên, chọn thì điền tên', async () => {
    const { u } = renderThread();
    await u.click(screen.getAllByRole('button', { name: 'Trả lời' })[0]!);
    await u.type(replyBox()!, '@Lo');
    await u.click(screen.getByRole('button', { name: /Nguyễn Minh Long/ }));
    expect(replyBox()).toHaveValue('@Nguyễn Minh Long ');
  });

  it('gốc đã xoá -> hiện "Bình luận đã bị xoá", không có nút trên gốc, câu trả lời vẫn trả lời được', () => {
    renderThread(
      {},
      {
        root: { ...item('root', '', LONG), deleted: true },
        replies: [item('r1', 'Câu trả lời còn lại', MAI, 'root')],
      }
    );
    expect(screen.getByText('Bình luận đã bị xoá')).toBeInTheDocument();
    expect(screen.queryByText('Nguyễn Minh Long')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Trả lời' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Xoá' })).not.toBeInTheDocument();
  });

  it('chỉ xem (readOnly) -> không có nút Trả lời / Xoá', () => {
    renderThread({ readOnly: true });
    expect(screen.queryByRole('button', { name: 'Trả lời' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xoá' })).not.toBeInTheDocument();
  });
});
