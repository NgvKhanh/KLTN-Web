import { useState } from 'react';
import type { CommentThreadGroup } from '../../../lib/commentThreads';
import type { BoardMember } from '../../../types/board';
import Avatar from '../../Avatar';
import CommentComposer from './CommentComposer';
import { fmt } from './helpers';

// Dung chung cho the trong bang (CardComment) va the cong khai (PublicComment)
export interface ThreadItem {
  id: string;
  parentId: string | null;
  text: string;
  createdAt: string;
  deleted?: boolean;
  user: { id: string; name: string; avatarUrl?: string | null };
}

interface Props {
  thread: CommentThreadGroup<ThreadItem>;
  currentUserId?: string;
  // Chi xem (VIEWER, trang cong khai): khong co nut Tra loi / Xoa
  readOnly?: boolean;
  boardMembers?: BoardMember[];
  // parentId = binh luan duoc bam "Tra loi" (goc hoac 1 cau tra loi); true = gui thanh cong
  onReply?: (parentId: string, text: string) => Promise<boolean>;
  onDelete?: (commentId: string) => void;
}

const ACTION = 'text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-100';

/** 1 luong binh luan: binh luan goc, cac cau tra loi thut le ben duoi, o tra loi khi bam "Trả lời". */
export default function CommentThread({
  thread,
  currentUserId,
  readOnly = false,
  boardMembers = [],
  onReply,
  onDelete,
}: Props) {
  // Dang tra loi ai: o nhap mo o cuoi luong, dien san "@Ten " (tru khi tra loi chinh minh)
  const [replyTo, setReplyTo] = useState<ThreadItem | null>(null);
  const canReply = !readOnly && Boolean(onReply);

  function renderItem(c: ThreadItem, isReply: boolean) {
    if (c.deleted) {
      return (
        <div className="flex gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
            </svg>
          </span>
          <p className="mt-1.5 text-sm italic text-slate-500 dark:text-slate-400">Bình luận đã bị xoá</p>
        </div>
      );
    }
    const mine = c.user.id === currentUserId;
    return (
      <div className="flex gap-2">
        <Avatar
          id={c.user.id}
          name={c.user.name}
          avatarUrl={c.user.avatarUrl}
          className={isReply ? 'h-6 w-6 text-[10px]' : undefined}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-200">{c.user.name}</span>{' '}
            <span className="text-slate-600 dark:text-slate-400">{fmt(c.createdAt)}</span>
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-words rounded-lg bg-white dark:bg-slate-800 p-2 text-sm text-slate-700 dark:text-slate-200 ring-1 ring-slate-200 dark:ring-slate-700">
            {c.text}
          </p>
          {(canReply || (!readOnly && mine && onDelete)) && (
            <div className="mt-0.5 flex gap-3">
              {canReply && (
                <button type="button" onClick={() => setReplyTo(c)} className={ACTION}>
                  Trả lời
                </button>
              )}
              {!readOnly && mine && onDelete && (
                <button type="button" onClick={() => onDelete(c.id)} className={ACTION}>
                  Xoá
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  const { root, replies } = thread;
  return (
    <li>
      {renderItem(root, false)}
      {(replies.length > 0 || replyTo) && (
        <ul
          aria-label="Các câu trả lời"
          className="ml-4 mt-2 flex flex-col gap-2 border-l-2 border-slate-200 pl-4 dark:border-slate-700"
        >
          {replies.map((r) => (
            <li key={r.id}>{renderItem(r, true)}</li>
          ))}
          {replyTo && onReply && (
            <li>
              <CommentComposer
                // Doi nguoi duoc tra loi -> dung lai o nhap moi voi "@Ten" moi
                key={replyTo.id}
                boardMembers={boardMembers}
                placeholder="Viết câu trả lời..."
                initialText={replyTo.user.id === currentUserId ? '' : `@${replyTo.user.name} `}
                autoFocus
                onSubmit={async (text) => {
                  const ok = await onReply(replyTo.id, text);
                  if (ok) setReplyTo(null);
                  return ok;
                }}
                onCancel={() => setReplyTo(null)}
              />
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
