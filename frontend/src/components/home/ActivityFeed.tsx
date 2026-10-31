import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { activityPhrase } from '../../lib/activityText';
import { fetchHomeActivity, type HomeActivity, type HomeActivityScope } from '../../lib/api/board';
import { getErrorMessage } from '../../lib/errorMessage';
import { activityTime, collapseActivity, groupByDay } from '../../lib/homeActivity';
import Avatar from '../Avatar';
import EmptyState from '../EmptyState';
import { SkeletonRegion, SkeletonRows } from '../Skeleton';
import HomeSection from './HomeSection';
import Segmented from './Segmented';

const SCOPE_KEY = 'tf.home.activityScope';

const SCOPES: { key: HomeActivityScope; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'others', label: 'Người khác' },
];

// Lua chon chi la tien ich cua tung may: doc/ghi loi (an danh, chan luu tru) thi dung mac dinh
function readScope(): HomeActivityScope {
  try {
    return localStorage.getItem(SCOPE_KEY) === 'others' ? 'others' : 'all';
  } catch {
    return 'all';
  }
}

function saveScope(scope: HomeActivityScope) {
  try {
    localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    // bo qua
  }
}

// Khoi "Hoat dong gan day": tu tai du lieu theo pham vi (tat ca / nguoi khac), nhom theo ngay, gop thao tac lien tiep
// tren cung mot the. Khung cao co han + thanh cuon rieng (cuon het danh sach khong keo ca trang theo).
export default function ActivityFeed() {
  const { user } = useAuth();
  const [scope, setScope] = useState<HomeActivityScope>(readScope);
  const [rows, setRows] = useState<HomeActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    fetchHomeActivity(scope)
      .then((list) => {
        if (cancelled) return;
        setRows(list);
        setNow(new Date());
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err, 'Không tải được hoạt động gần đây.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  function choose(next: HomeActivityScope) {
    if (next === scope) return;
    setLoading(true);
    setScope(next);
    saveScope(next);
  }

  const groups = useMemo(() => groupByDay(collapseActivity(rows), now), [rows, now]);
  // Dang tai lai khi doi pham vi: giu danh sach cu (lam mo), khong nhay ve khung cho
  const firstLoad = loading && rows.length === 0;

  return (
    <HomeSection
      title="Hoạt động gần đây"
      className="flex max-h-[32rem] flex-col"
      action={<Segmented label="Lọc hoạt động" options={SCOPES} value={scope} onChange={choose} />}
    >
      {firstLoad ? (
        <SkeletonRegion label="Đang tải hoạt động gần đây…">
          <SkeletonRows rows={5} />
        </SkeletonRegion>
      ) : error ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{error}</p>
      ) : groups.length === 0 ? (
        scope === 'others' ? (
          <EmptyState
            compact
            icon="activity"
            title="Chưa có ai khác hoạt động trên các bảng của bạn."
            action={
              <button
                type="button"
                onClick={() => choose('all')}
                className="text-sm font-medium text-primary-ink hover:underline"
              >
                Xem cả hoạt động của bạn
              </button>
            }
          />
        ) : (
          <EmptyState compact icon="activity" title="Chưa có hoạt động nào." />
        )
      ) : (
        <div
          aria-label="Hoạt động gần đây"
          aria-busy={loading}
          tabIndex={0}
          className={`tf-scroll -mr-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pr-3 transition-opacity focus-visible:outline-2 focus-visible:outline-primary ${
            loading ? 'opacity-60' : ''
          }`}
        >
          {groups.map((g) => (
            <section key={g.heading} aria-label={g.heading}>
              <h3 className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">{g.heading}</h3>
              <ul className="flex flex-col gap-3">
                {g.items.map(({ item: a, count }) => {
                  const mine = a.user.id === user?.id;
                  return (
                    <li key={a.id} className="flex gap-2">
                      <Avatar id={a.user.id} name={a.user.name} avatarUrl={a.user.avatarUrl} className="h-6 w-6 text-[10px]" />
                      <div className="min-w-0 flex-1 text-xs">
                        <p className="text-slate-600 dark:text-slate-300">
                          <span className="font-semibold text-slate-700 dark:text-slate-100">{mine ? 'Bạn' : a.user.name}</span>{' '}
                          {activityPhrase(a)}
                        </p>
                        {a.card?.title && a.board && (
                          <Link
                            to={`/boards/${a.board.id}?card=${a.card.id}`}
                            className="mt-0.5 block truncate font-medium text-primary-ink hover:underline"
                          >
                            {a.card.title}
                          </Link>
                        )}
                        <p className="mt-0.5 truncate text-slate-400 dark:text-slate-500">
                          {a.board && (
                            <>
                              <Link to={`/boards/${a.board.id}`} className="hover:underline">
                                {a.board.name}
                              </Link>
                              {' · '}
                            </>
                          )}
                          <time dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString('vi-VN')}>
                            {activityTime(a.createdAt, now)}
                          </time>
                          {count > 1 && <> · +{count - 1} thao tác khác trên thẻ này</>}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </HomeSection>
  );
}
