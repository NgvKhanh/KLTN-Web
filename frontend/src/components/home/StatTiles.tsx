import { useNavigate } from 'react-router-dom';
import { dayLabel, type HomeStats } from '../../lib/homeStats';
import { useCountUp } from '../../lib/useCountUp';
import { Skeleton } from '../Skeleton';

// Co du lieu thi dem len; dang tai hien khung cho (khong hien 0); tai loi hien dau gach ngang thay vi so 0 gay hieu nham.
function StatValue({ value, loading, failed }: { value: number; loading: boolean; failed: boolean }) {
  const shown = useCountUp(value, { enabled: !loading });
  if (loading) return <Skeleton className="h-8 w-10" />;
  if (failed) return <>–</>;
  return <>{shown}</>;
}

interface Tile {
  label: string;
  value: number;
  /** Dong phu: ngu canh cua con so (vd "trễ nhất 12 ngày"). */
  note: string;
  to: string;
  valueClass?: string;
}

function tiles(s: HomeStats, now: Date): Tile[] {
  return [
    {
      label: 'Thẻ đang mở',
      value: s.open,
      note: s.open > 0 ? `trên ${s.openBoards} bảng` : 'Không có thẻ nào đang mở',
      to: '/my-cards',
    },
    {
      label: 'Quá hạn',
      value: s.overdue,
      note:
        s.overdue === 0
          ? 'Không có thẻ trễ hạn'
          : s.maxLateDays > 0
            ? `trễ nhất ${s.maxLateDays} ngày`
            : 'quá giờ trong hôm nay',
      to: '/my-cards',
      valueClass: s.overdue > 0 ? 'text-red-600 dark:text-red-400' : undefined,
    },
    {
      label: 'Đến hạn 7 ngày tới',
      value: s.upcoming,
      note: s.nextDue ? `gần nhất ${dayLabel(s.nextDue, now)}` : 'Không có hạn nào',
      to: '/calendar',
    },
    {
      label: 'Xong tuần này',
      value: s.doneThisWeek,
      note: `tuần trước ${s.doneLastWeek}`,
      to: '/my-cards',
      valueClass: s.doneThisWeek > 0 ? 'text-emerald-700 dark:text-emerald-400' : undefined,
    },
  ];
}

export default function StatTiles({
  stats,
  now,
  loading,
  failed,
}: {
  stats: HomeStats;
  now: Date;
  loading: boolean;
  failed: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles(stats, now).map((t) => (
        <button
          key={t.label}
          type="button"
          onClick={() => navigate(t.to)}
          className="flex flex-col justify-start rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:shadow dark:border-slate-700 dark:bg-slate-800"
        >
          <span className="block text-xs text-slate-500 dark:text-slate-400">{t.label}</span>
          <span className={`mt-1 block text-2xl font-bold ${t.valueClass ?? 'text-slate-900 dark:text-slate-100'}`}>
            <StatValue value={t.value} loading={loading} failed={failed} />
          </span>
          <span className="mt-0.5 block min-h-4 text-xs text-slate-500 dark:text-slate-400">
            {loading ? <Skeleton className="h-3 w-20" /> : failed ? '' : t.note}
          </span>
        </button>
      ))}
    </div>
  );
}
