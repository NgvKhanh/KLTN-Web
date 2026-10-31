import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CreateBoardMenu } from '../components/Header';
import ActivityFeed from '../components/home/ActivityFeed';
import AttentionList from '../components/home/AttentionList';
import BoardProgressList from '../components/home/BoardProgressList';
import CompletionChart from '../components/home/CompletionChart';
import HomeSection from '../components/home/HomeSection';
import StatTiles from '../components/home/StatTiles';
import WeekStrip from '../components/home/WeekStrip';
import { SkeletonRegion, SkeletonRows } from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';
import { useBoards } from '../context/BoardsContext';
import { fetchMyCards, updateCard, type MyCard } from '../lib/api/card';
import { getErrorMessage } from '../lib/errorMessage';
import { homeStats } from '../lib/homeStats';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Chào buổi sáng';
  if (h < 14) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

function firstName(name?: string): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

const linkCls = 'text-xs font-medium text-primary-ink hover:underline';

// Trang Tong quan (/home). Cac khoi 1-5 tinh tu danh sach the duoc giao (/cards/mine, tai mot lan o day);
// khoi 6 (hoat dong) tu tai theo pham vi rieng.
export default function HomeDashboard() {
  const { user } = useAuth();
  const { boards, isLoading: boardsLoading } = useBoards();

  const [myCards, setMyCards] = useState<MyCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // "Qua han" / "hom nay" / "tuan nay" tinh theo thoi diem tai the gan nhat
  const [now, setNow] = useState(() => new Date());
  // The vua tick tren trang nay: giu lai trong khoi Can chu y (gach ngang) de bo tick duoc
  const [keepIds, setKeepIds] = useState<ReadonlySet<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const applyCards = useCallback((cards: MyCard[]) => {
    setMyCards(cards);
    setNow(new Date());
  }, []);

  useEffect(() => {
    fetchMyCards()
      .then(applyCards)
      .catch((err) => setError(getErrorMessage(err, 'Không tải được thẻ của bạn.')))
      .finally(() => setLoading(false));
  }, [applyCards]);

  // Tick xong / mo lai ngay tren trang: doi giao dien truoc, loi thi tra lai nhu cu
  const toggleDone = useCallback(
    async (card: MyCard) => {
      const next = !card.isDone;
      setActionError(null);
      setKeepIds((cur) => new Set(cur).add(card.id));
      const completedAt = next ? new Date().toISOString() : null;
      setMyCards((cur) => cur.map((c) => (c.id === card.id ? { ...c, isDone: next, completedAt } : c)));
      try {
        await updateCard(card.id, { isDone: next });
        // Danh dau xong co the chuyen the sang cot "Hoan thanh": tai lai de cot / trang thai dung
        fetchMyCards().then(applyCards).catch(() => undefined);
      } catch (err) {
        setMyCards((cur) =>
          cur.map((c) => (c.id === card.id ? { ...c, isDone: card.isDone, completedAt: card.completedAt } : c))
        );
        setActionError(getErrorMessage(err, 'Không cập nhật được thẻ.'));
      }
    },
    [applyCards]
  );

  const stats = useMemo(() => homeStats(myCards, now), [myCards, now]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {greeting()}
            {user?.name ? `, ${firstName(user.name)}` : ''} 👋
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {new Date().toLocaleDateString('vi-VN', {
              weekday: 'long',
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })}
          </p>
        </div>
        <CreateBoardMenu label="Tạo bảng" />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* 1. So lieu co ngu canh */}
      <StatTiles stats={stats} now={now} loading={loading} failed={Boolean(error)} />

      {/* 2. Hom nay + 7 ngay toi */}
      {!error && (
        <HomeSection
          title="7 ngày tới"
          action={
            <Link to="/calendar" className={linkCls}>
              Mở lịch
            </Link>
          }
        >
          {loading ? (
            <SkeletonRegion label="Đang tải lịch 7 ngày tới…">
              <SkeletonRows rows={2} />
            </SkeletonRegion>
          ) : (
            <WeekStrip cards={myCards} now={now} />
          )}
        </HomeSection>
      )}

      {/* Tu 1280px: cot chinh (can chu y + bang cua ban) va cot phu (hoan thanh + hoat dong) ti le 2:1 */}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-2">
          {/* 3. Can chu y */}
          <HomeSection
            title="Cần chú ý"
            action={
              <Link to="/my-cards" className={linkCls}>
                Xem tất cả
              </Link>
            }
          >
            {actionError && (
              <p role="alert" className="mb-2 text-sm text-red-600">
                {actionError}
              </p>
            )}
            {loading ? (
              <SkeletonRegion label="Đang tải thẻ cần chú ý…">
                <SkeletonRows rows={3} />
              </SkeletonRegion>
            ) : error ? (
              // Tai loi: khong hien "khong co the nao" de khoi hieu nham la da xu ly xong
              <p className="text-sm text-slate-500 dark:text-slate-400">Không tải được danh sách thẻ.</p>
            ) : (
              <AttentionList cards={myCards} now={now} keepIds={keepIds} onToggleDone={(c) => void toggleDone(c)} />
            )}
          </HomeSection>

          {/* 4. Bang cua ban: tien do + viec cua minh tren tung bang */}
          <HomeSection
            title="Bảng của bạn"
            action={
              <Link to="/boards" className={linkCls}>
                Tất cả bảng
              </Link>
            }
          >
            {loading || boardsLoading ? (
              <SkeletonRegion label="Đang tải bảng của bạn…">
                <SkeletonRows rows={3} />
              </SkeletonRegion>
            ) : (
              <BoardProgressList boards={boards} cards={myCards} now={now} />
            )}
          </HomeSection>
        </div>

        {/* Cot phu */}
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-1">
          {/* 5. Da hoan thanh theo tuan */}
          {!error && (
            <HomeSection title="Bạn đã hoàn thành">
              {loading ? (
                <SkeletonRegion label="Đang tải số thẻ đã hoàn thành…">
                  <SkeletonRows rows={3} />
                </SkeletonRegion>
              ) : (
                <CompletionChart cards={myCards} now={now} />
              )}
            </HomeSection>
          )}

          {/* 6. Hoat dong gan day */}
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}
