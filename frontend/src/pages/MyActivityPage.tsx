import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMyActivity, type MyActivity } from '../lib/api/auth';
import { SkeletonRegion, SkeletonRows } from '../components/Skeleton';
import { getErrorMessage } from '../lib/errorMessage';
import { describeActivity, groupByDay, timeOf, type ActivityIcon } from '../lib/myActivity';
import EmptyState from '../components/EmptyState';

// Nét vẽ 24x24 cho từng loại hoạt động (đồng bộ nét 1.8 với các biểu tượng khác của ứng dụng)
const ICON_PATH: Record<ActivityIcon, string> = {
  create: 'M12 5v14M5 12h14',
  move: 'M5 12h14M13 6l6 6-6 6',
  rename: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  done: 'M5 13l4 4L19 7',
  reopen: 'M4 12a8 8 0 108-8H7M7 4L4 7l3 3',
  status: 'M5 4v17M5 5h11l-2 4 2 4H5',
  due: 'M5 4h14a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM3 10h18M8 2v4M16 2v4',
  comment: 'M4 5h16v11H9l-5 4V5z',
  member: 'M16 20v-1a4 4 0 00-4-4H8a4 4 0 00-4 4v1M10 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM20 20v-1a4 4 0 00-3-3.9',
  attach: 'M20 11l-8 8a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 01-3-3l8-8',
  checklist: 'M9 6h11M9 12h11M9 18h11M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2',
  archive: 'M4 7h16v3H4zM6 10v9h12v-9M10 14h4',
  ai: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z',
  other: 'M12 12h.01',
};

function ActivityGlyph({ icon }: { icon: ActivityIcon }) {
  const tone = icon === 'done' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300';
  return (
    <span aria-hidden="true" className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${tone}`}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICON_PATH[icon]} />
      </svg>
    </span>
  );
}

export default function MyActivityPage() {
  const [items, setItems] = useState<MyActivity[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boardId, setBoardId] = useState('');
  const [now] = useState(() => new Date());

  useEffect(() => {
    fetchMyActivity()
      .then((res) => {
        setItems(res.activities);
        setHasMore(res.hasMore);
      })
      .catch((err) => setError(getErrorMessage(err, 'Không tải được hoạt động.')))
      .finally(() => setLoading(false));
  }, []);

  const loadMore = useCallback(async () => {
    const last = items[items.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchMyActivity(last.createdAt);
      setItems((cur) => {
        const seen = new Set(cur.map((a) => a.id));
        return [...cur, ...res.activities.filter((a) => !seen.has(a.id))];
      });
      setHasMore(res.hasMore);
    } catch (err) {
      setError(getErrorMessage(err, 'Không tải thêm được hoạt động.'));
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore]);

  const boards = useMemo(() => {
    const byId = new Map<string, string>();
    for (const a of items) if (a.board) byId.set(a.board.id, a.board.name);
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name, 'vi'));
  }, [items]);

  const visible = useMemo(() => (boardId === '' ? items : items.filter((a) => a.board?.id === boardId)), [items, boardId]);
  const groups = useMemo(() => groupByDay(visible, now), [visible, now]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Hoạt động của tôi</h1>
        {boards.length > 1 && (
          <select
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            aria-label="Lọc theo bảng"
            className="ml-auto h-9 max-w-[16rem] rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="">Tất cả bảng</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <SkeletonRegion label="Đang tải hoạt động…">
          <SkeletonRows rows={6} boxed />
        </SkeletonRegion>
      ) : error && items.length === 0 ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : items.length === 0 ? (
        <EmptyState icon="activity" title="Chưa có hoạt động nào." description="Những gì bạn làm trên các bảng sẽ được ghi lại ở đây." />
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="mb-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">{g.label}</h2>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-700/60 dark:border-slate-700 dark:bg-slate-800">
                {g.items.map((a) => {
                  const t = describeActivity(a);
                  const title = a.card?.title ?? null;
                  const cardLink = a.card && !a.card.deleted && a.board ? `/boards/${a.board.id}?card=${a.card.id}` : null;
                  return (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                      <ActivityGlyph icon={t.icon} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-700 dark:text-slate-200">
                          {t.verb}
                          {t.withCard && title !== null && (
                            <>
                              {' '}
                              {cardLink ? (
                                <Link to={cardLink} className="font-medium text-slate-900 hover:text-primary-ink hover:underline dark:text-slate-100">
                                  “{title}”
                                </Link>
                              ) : (
                                <span className="font-medium text-slate-900 dark:text-slate-100">“{title}”</span>
                              )}
                              {a.card?.deleted && <span className="text-slate-500 dark:text-slate-400"> (đã xoá)</span>}
                            </>
                          )}
                          {t.detail && <span className="text-slate-600 dark:text-slate-300"> {t.detail}</span>}
                        </p>
                        {t.quote && (
                          <p className="mt-1 line-clamp-2 border-l-2 border-slate-200 pl-2 text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">{t.quote}</p>
                        )}
                        {a.board && (
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            <Link to={`/boards/${a.board.id}`} className="hover:text-primary-ink hover:underline">
                              {a.board.name}
                            </Link>
                          </p>
                        )}
                      </div>
                      <time dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString('vi-VN')} className="shrink-0 pt-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        {timeOf(a.createdAt)}
                      </time>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {groups.length === 0 && (
            <EmptyState compact icon="activity" title="Không có hoạt động nào ở bảng này trong phần đã tải." />
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {hasMore && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="self-center rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/50"
            >
              {loadingMore ? 'Đang tải…' : 'Xem thêm'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
