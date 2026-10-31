import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchBoardActivity, type BoardActivity } from '../../lib/api/board';
import { activityPhrase } from '../../lib/activityText';
import { initialsOf } from '../../lib/avatar';
import { getErrorMessage } from '../../lib/errorMessage';
import { SkeletonRegion, SkeletonRows } from '../Skeleton';

interface Props {
  boardId: string;
  onClose: () => void;
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 604800) return `${Math.floor(s / 86400)} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN');
}

export default function BoardActivityMenu({ boardId, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<BoardActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBoardActivity(boardId)
      .then(setItems)
      .catch((err) =>
        setError(getErrorMessage(err, 'Không tải được nhật ký hoạt động.'))
      )
      .finally(() => setLoading(false));
  }, [boardId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (
        ref.current &&
        !ref.current.contains(t) &&
        !t.closest('[data-activity-trigger]')
      ) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="tf-menu-in fixed right-3 top-14 z-50 w-96 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-800 dark:text-slate-100 shadow-2xl"
    >
      <p className="pb-1 text-center text-sm font-semibold">Hoạt động</p>
      {error && <p className="px-1 text-xs text-red-600">{error}</p>}
      {loading ? (
        <SkeletonRegion label="Đang tải…" className="py-3">
          <SkeletonRows rows={3} />
        </SkeletonRegion>
      ) : items.length === 0 ? (
        <p className="px-1 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
          Chưa có hoạt động nào.
        </p>
      ) : (
        <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto py-1">
          {items.map((a) => (
            <li key={a.id} className="flex gap-2 px-1">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#7f5ad5] text-[10px] font-semibold text-white">
                {initialsOf(a.user.name)}
              </span>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {a.user.name}
                </span>{' '}
                {activityPhrase(a)}
                {a.card && (
                  <span className="text-slate-500 dark:text-slate-400"> — “{a.card.title}”</span>
                )}
                <br />
                <span className="text-slate-500 dark:text-slate-400">{timeAgo(a.createdAt)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body
  );
}
