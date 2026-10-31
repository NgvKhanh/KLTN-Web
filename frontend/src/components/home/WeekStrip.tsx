import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { MyCard } from '../../lib/api/card';
import { weekAhead, weekdayShort } from '../../lib/homeStats';

// Moi o chi ghi ten vai the dau (man hinh rong), con lai xem o trang Lich
export const WEEK_CELL_TITLES = 2;

const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

export default function WeekStrip({ cards, now }: { cards: MyCard[]; now: Date }) {
  const { days, overdueBefore } = useMemo(() => weekAhead(cards, now), [cards, now]);
  const empty = overdueBefore === 0 && days.every((d) => d.cards.length === 0);

  return (
    <>
      <ol className="grid grid-cols-4 gap-2 lg:grid-cols-8">
        {days.map(({ date, cards: dayCards }, i) => {
          const isToday = i === 0;
          const more = dayCards.length - WEEK_CELL_TITLES;
          return (
            <li
              key={date.getTime()}
              aria-label={`${isToday ? 'Hôm nay' : weekdayShort(date)} ${ddmm(date)}: ${dayCards.length} thẻ đến hạn`}
              className={`flex min-h-[4.5rem] min-w-0 flex-col gap-1 rounded-lg border p-2 ${
                isToday ? 'border-primary/40 bg-primary-soft' : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <p className="flex flex-wrap items-baseline gap-x-1 text-xs">
                <span
                  className={`whitespace-nowrap ${isToday ? 'font-semibold text-primary-ink' : 'font-medium text-slate-600 dark:text-slate-300'}`}
                >
                  {isToday ? 'Hôm nay' : weekdayShort(date)}
                </span>
                <span className="whitespace-nowrap tabular-nums text-slate-400">{ddmm(date)}</span>
              </p>

              {isToday && overdueBefore > 0 && (
                <Link
                  to="/my-cards"
                  className="whitespace-nowrap text-[11px] font-medium text-red-700 hover:underline sm:text-xs dark:text-red-300"
                >
                  +{overdueBefore} quá hạn
                </Link>
              )}

              {/* Man hinh hep: chi so the; tu 1280px: ten vai the dau, bam mo thang the */}
              {dayCards.length > 0 && (
                <span className="text-xs text-slate-600 dark:text-slate-300 xl:hidden">{dayCards.length} thẻ</span>
              )}
              <ul className="hidden min-w-0 flex-col gap-1 xl:flex">
                {dayCards.slice(0, WEEK_CELL_TITLES).map((c) => (
                  <li key={c.id} className="min-w-0">
                    <Link
                      to={`/boards/${c.list.boardId}?card=${c.id}`}
                      title={`${c.title} · ${c.list.board.name}`}
                      className="flex min-w-0 items-center gap-1.5 rounded bg-white px-1.5 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200 hover:ring-primary dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700"
                    >
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: c.list.board.color }}
                      />
                      <span className="truncate">{c.title}</span>
                    </Link>
                  </li>
                ))}
                {more > 0 && (
                  <li>
                    <Link to="/calendar" className="text-xs text-slate-500 hover:underline dark:text-slate-400">
                      +{more} thẻ nữa
                    </Link>
                  </li>
                )}
              </ul>
            </li>
          );
        })}
      </ol>
      {empty && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Không có thẻ nào đến hạn trong 7 ngày tới.</p>
      )}
    </>
  );
}
