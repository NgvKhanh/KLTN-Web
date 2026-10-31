import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { purgeCard, restoreCard } from '../../lib/api/card';
import { purgeList, restoreList } from '../../lib/api/list';
import {
  fetchBoardArchive,
  type ArchivedCard,
  type ArchivedList,
} from '../../lib/api/board';
import { getErrorMessage } from '../../lib/errorMessage';
import { SkeletonRegion, SkeletonRows } from '../Skeleton';

interface Props {
  boardId: string;
  onClose: () => void;
  onChanged: () => void; // bao BoardPage tai lai danh sach
}

export default function BoardArchiveMenu({ boardId, onClose, onChanged }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'cards' | 'lists'>('cards');
  const [cards, setCards] = useState<ArchivedCard[]>([]);
  const [lists, setLists] = useState<ArchivedList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchBoardArchive(boardId)
      .then((d) => {
        setCards(d.cards);
        setLists(d.lists);
      })
      .catch((err) =>
        setError(getErrorMessage(err, 'Không tải được mục đã lưu trữ.'))
      )
      .finally(() => setLoading(false));
  }, [boardId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (
        ref.current &&
        !ref.current.contains(t) &&
        !t.closest('[data-archive-trigger]')
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

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      load();
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, 'Thao tác thất bại.'));
    } finally {
      setBusyId(null);
    }
  }

  const tabBtn = (key: 'cards' | 'lists', label: string, n: number) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`flex-1 rounded-lg py-1.5 text-sm font-medium ${
        tab === key
          ? 'bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100'
          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
      }`}
    >
      {label} {n > 0 && <span className="text-xs">({n})</span>}
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      className="tf-menu-in fixed right-3 top-14 z-50 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-800 dark:text-slate-100 shadow-2xl"
    >
      <p className="pb-1 text-center text-sm font-semibold">Mục đã lưu trữ</p>
      <div className="mb-2 flex gap-1">
        {tabBtn('cards', 'Thẻ', cards.length)}
        {tabBtn('lists', 'Danh sách', lists.length)}
      </div>

      {error && <p className="mb-1 px-1 text-xs text-red-600">{error}</p>}
      {loading ? (
        <SkeletonRegion label="Đang tải…" className="py-3">
          <SkeletonRows rows={3} />
        </SkeletonRegion>
      ) : tab === 'cards' ? (
        cards.length === 0 ? (
          <p className="px-1 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
            Không có thẻ nào được lưu trữ.
          </p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {cards.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-slate-200 dark:border-slate-700 p-2"
              >
                <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                  {c.title}
                </p>
                <p className="mb-1.5 truncate text-xs text-slate-500 dark:text-slate-400">
                  trong danh sách "{c.list.name}"
                </p>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() => void act(c.id, () => restoreCard(c.id))}
                    className="rounded bg-slate-100 dark:bg-slate-700 px-2 py-1 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50"
                  >
                    Khôi phục
                  </button>
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() => void act(c.id, () => purgeCard(c.id))}
                    className="rounded px-2 py-1 font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Xoá
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : lists.length === 0 ? (
        <p className="px-1 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
          Không có danh sách nào được lưu trữ.
        </p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {lists.map((l) => (
            <li key={l.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
              <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                {l.name}
              </p>
              <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">
                {l.cardCount} thẻ bên trong
              </p>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  disabled={busyId === l.id}
                  onClick={() => void act(l.id, () => restoreList(l.id))}
                  className="rounded bg-slate-100 dark:bg-slate-700 px-2 py-1 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50"
                >
                  Khôi phục
                </button>
                <button
                  type="button"
                  disabled={busyId === l.id}
                  onClick={() => void act(l.id, () => purgeList(l.id))}
                  className="rounded px-2 py-1 font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Xoá
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body
  );
}
