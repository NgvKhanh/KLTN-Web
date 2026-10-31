import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMyCards, updateCard, type MyCard } from '../lib/api/card';
import { Skeleton, SkeletonRegion, SkeletonRows } from '../components/Skeleton';
import StatusBadge from '../components/board/StatusBadge';
import EmptyState from '../components/EmptyState';
import { shouldShowCardStatus } from '../lib/cardStatus';
import { getErrorMessage } from '../lib/errorMessage';
import { BUCKET_LABEL, BUCKET_ORDER, bucketOf, dueNote, matchesTitle, type Bucket, type DueTone } from '../lib/myCards';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const TONE_CLASS: Record<DueTone, string> = {
  danger: 'text-red-700 dark:text-red-300',
  warn: 'text-amber-700 dark:text-amber-300',
  muted: 'text-slate-500 dark:text-slate-400',
};

// Cot tren dau nhom: chi mau o cham nho (y nghia: muc khan cap), khong to ca dong
const BUCKET_DOT: Record<Bucket, string> = {
  overdue: 'bg-red-500',
  today: 'bg-amber-500',
  week: 'bg-primary',
  later: 'bg-slate-400',
  none: 'bg-slate-300 dark:bg-slate-600',
};

const GRID = 'md:grid md:grid-cols-[minmax(0,1fr)_15rem_8.5rem] md:items-center md:gap-x-4';

export default function MyCardsPage() {
  const [cards, setCards] = useState<MyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(true);
  const [query, setQuery] = useState('');
  const [boardId, setBoardId] = useState('');
  const [collapsed, setCollapsed] = useState<Set<Bucket>>(new Set());
  // "Hom nay" / "qua han" tinh theo thoi diem tai du lieu gan nhat
  const [now, setNow] = useState(() => new Date());

  const apply = useCallback((list: MyCard[]) => {
    setCards(list);
    setNow(new Date());
  }, []);

  useEffect(() => {
    fetchMyCards()
      .then(apply)
      .catch((err) => setError(getErrorMessage(err, 'Không tải được thẻ.')))
      .finally(() => setLoading(false));
  }, [apply]);

  const boards = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of cards) byId.set(c.list.boardId, c.list.board.name);
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [cards]);

  const open = useMemo(() => cards.filter((c) => !c.isDone), [cards]);
  const overdueCount = useMemo(() => open.filter((c) => bucketOf(c.dueDate, now) === 'overdue').length, [open, now]);

  const visible = useMemo(
    () =>
      cards.filter(
        (c) => (!hideDone || !c.isDone) && (boardId === '' || c.list.boardId === boardId) && matchesTitle(c.title, query)
      ),
    [cards, hideDone, boardId, query]
  );

  const groups = useMemo(() => {
    const map = new Map<Bucket, MyCard[]>();
    for (const c of visible) {
      const b = bucketOf(c.dueDate, now);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(c);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({ bucket: b, items: map.get(b)! }));
  }, [visible, now]);

  const filtering = query.trim() !== '' || boardId !== '';

  const toggleDone = useCallback(
    async (card: MyCard) => {
      const next = !card.isDone;
      setActionError(null);
      setCards((cur) => cur.map((c) => (c.id === card.id ? { ...c, isDone: next } : c)));
      try {
        await updateCard(card.id, { isDone: next });
        // Danh dau xong co the chuyen the sang cot "Hoan thanh": tai lai de cot / trang thai hien dung
        fetchMyCards().then(apply).catch(() => undefined);
      } catch (err) {
        setCards((cur) => cur.map((c) => (c.id === card.id ? { ...c, isDone: card.isDone } : c)));
        setActionError(getErrorMessage(err, 'Không cập nhật được thẻ.'));
      }
    },
    [apply]
  );

  function toggleGroup(bucket: Bucket) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Công việc của tôi</h1>
        {!loading && !error && cards.length > 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {open.length} thẻ đang mở
            {overdueCount > 0 && (
              <>
                {', '}
                <span className="font-medium text-red-700 dark:text-red-300">{overdueCount} quá hạn</span>
              </>
            )}
          </p>
        )}
      </div>

      {!loading && !error && cards.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Lọc theo tên thẻ</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Lọc theo tên thẻ"
              className="h-9 w-56 rounded-lg border border-slate-300 bg-white pl-8 pr-2 text-sm focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-900"
            />
          </label>

          {boards.length > 1 && (
            <select
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
              aria-label="Lọc theo bảng"
              className="h-9 max-w-[16rem] rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            >
              <option value="">Tất cả bảng</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          <label className="ml-auto flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
            Ẩn thẻ đã hoàn thành
          </label>
        </div>
      )}

      {actionError && (
        <p role="alert" className="text-sm text-red-600">
          {actionError}
        </p>
      )}

      {loading ? (
        <SkeletonRegion label="Đang tải thẻ của bạn…" className="flex flex-col gap-2">
          <Skeleton className="h-3 w-28" />
          <SkeletonRows rows={5} boxed />
        </SkeletonRegion>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : cards.length === 0 ? (
        <EmptyState
          icon="tasks"
          title="Bạn chưa được gán vào thẻ nào."
          description="Khi có người giao việc cho bạn, thẻ sẽ hiện ở đây, xếp theo hạn."
          action={
            <Link to="/boards" className="text-sm font-medium text-primary-ink hover:underline">
              Xem các bảng
            </Link>
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon="tasks"
          compact
          title={filtering ? 'Không có thẻ nào khớp bộ lọc.' : 'Mọi thẻ của bạn đã hoàn thành.'}
          action={
            filtering ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setBoardId('');
                }}
                className="text-sm font-medium text-primary-ink hover:underline"
              >
                Bỏ bộ lọc
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setHideDone(false)}
                className="text-sm font-medium text-primary-ink hover:underline"
              >
                Hiện thẻ đã hoàn thành
              </button>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div
            className={`hidden border-b border-slate-200 px-4 py-2 text-xs font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400 ${GRID}`}
          >
            <span className="pl-7">Thẻ</span>
            <span>Bảng / cột</span>
            <span className="text-right">Hạn</span>
          </div>

          {groups.map(({ bucket, items }) => {
            const isCollapsed = collapsed.has(bucket);
            return (
              <section key={bucket} aria-label={BUCKET_LABEL[bucket]} className="border-b border-slate-200 last:border-b-0 dark:border-slate-700">
                <h2 className="m-0">
                  <button
                    type="button"
                    onClick={() => toggleGroup(bucket)}
                    aria-expanded={!isCollapsed}
                    className="flex w-full items-center gap-2 bg-slate-50 px-4 py-2 text-left text-sm hover:bg-slate-100 dark:bg-slate-900/40 dark:hover:bg-slate-900/70"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${BUCKET_DOT[bucket]}`} aria-hidden="true" />
                    <span
                      className={`font-semibold ${
                        bucket === 'overdue' ? 'text-red-700 dark:text-red-300' : 'text-slate-800 dark:text-slate-100'
                      }`}
                    >
                      {BUCKET_LABEL[bucket]}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{items.length}</span>
                  </button>
                </h2>

                {!isCollapsed && (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {items.map((c) => {
                      const note = c.isDone ? null : dueNote(c.dueDate, now);
                      const namedLabels = c.labels.filter((l) => l.label.name.trim() !== '');
                      return (
                        <li
                          key={c.id}
                          className={`relative px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/40 ${GRID}`}
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={c.isDone}
                              aria-label={c.isDone ? `Mở lại thẻ ${c.title}` : `Đánh dấu hoàn thành thẻ ${c.title}`}
                              onClick={() => void toggleDone(c)}
                              className={`relative z-10 mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 transition-colors ${
                                c.isDone
                                  ? 'border-emerald-600 bg-emerald-600 text-white'
                                  : 'border-slate-300 hover:border-emerald-600 dark:border-slate-500'
                              }`}
                            >
                              {c.isDone && (
                                <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="4">
                                  <path d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                            <div className="min-w-0 flex-1">
                              <Link
                                to={`/boards/${c.list.boardId}?card=${c.id}`}
                                className={`block truncate text-sm font-medium after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-primary ${
                                  c.isDone ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-slate-100'
                                }`}
                              >
                                {c.title}
                              </Link>
                              {c.labels.length > 0 && (
                                <span className="mt-1 flex flex-wrap gap-1">
                                  {namedLabels.map((l) => (
                                    <span
                                      key={l.labelId}
                                      className="inline-flex max-w-[10rem] items-center gap-1 rounded-full bg-slate-100 px-2 py-px text-[11px] text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                                    >
                                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: l.label.color }} />
                                      <span className="truncate">{l.label.name}</span>
                                    </span>
                                  ))}
                                  {c.labels
                                    .filter((l) => l.label.name.trim() === '')
                                    .map((l) => (
                                      <span
                                        key={l.labelId}
                                        aria-hidden="true"
                                        className="h-2 w-6 rounded-full"
                                        style={{ backgroundColor: l.label.color }}
                                      />
                                    ))}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="mt-1 min-w-0 pl-7 text-xs text-slate-500 dark:text-slate-400 md:mt-0 md:pl-0">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span
                                aria-hidden="true"
                                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                                style={{ backgroundColor: c.list.board.color }}
                              />
                              <span className="truncate text-sm text-slate-700 dark:text-slate-200">{c.list.board.name}</span>
                            </span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-4">
                              <span className="truncate">{c.list.name}</span>
                              {!c.isDone && shouldShowCardStatus(c.status, c.list.status) && <StatusBadge status={c.status} />}
                            </span>
                          </div>

                          <div className="mt-1 flex items-baseline gap-2 pl-7 md:mt-0 md:block md:pl-0 md:text-right">
                            {c.dueDate ? (
                              <>
                                <span
                                  className={`block text-sm tabular-nums ${
                                    note?.tone === 'danger' ? TONE_CLASS.danger : 'text-slate-700 dark:text-slate-200'
                                  }`}
                                >
                                  {fmtDate(c.dueDate)}
                                </span>
                                {note && <span className={`block text-xs ${TONE_CLASS[note.tone]}`}>{note.text}</span>}
                              </>
                            ) : (
                              <span className="text-sm text-slate-400">—</span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
