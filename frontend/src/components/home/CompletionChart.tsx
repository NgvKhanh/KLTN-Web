import { useMemo, useState } from 'react';
import type { MyCard } from '../../lib/api/card';
import { weeklyDone } from '../../lib/homeStats';

const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

function weekRange(start: Date): string {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${ddmm(start)} – ${ddmm(end)}`;
}

const PLOT_PX = 88;

// Cot theo tuan (mot chuoi): cot tuan nay mau thuong hieu, cac tuan truoc mau xam trung tinh. Re chuot / cham vao cot hien so the +
// khoang ngay; ban phim: Tab vao bieu do roi mui ten trai/phai. Bang an ben duoi cho trinh doc man hinh doc du so lieu.
export default function CompletionChart({ cards, now }: { cards: MyCard[]; now: Date }) {
  const data = useMemo(() => weeklyDone(cards, now), [cards, now]);
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...data.weeks.map((w) => w.count));
  const last = data.weeks.length - 1;

  if (max === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Chưa có thẻ nào của bạn hoàn thành trong 8 tuần qua.</p>;
  }

  // `relative`: bang an / vung aria-live (sr-only = position:absolute) phai co khoi chua nam TRONG vung cuon <main>.
  // Thieu no, chung tinh vi tri theo ca trang, keo dai tai lieu va lam ca khung ung dung cuon lo nen den ben duoi.
  return (
    <div className="relative">
      <div
        tabIndex={0}
        aria-label="Biểu đồ số thẻ hoàn thành theo tuần, dùng phím mũi tên trái phải để xem từng tuần"
        onFocus={() => setActive((cur) => cur ?? last)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setActive((cur) => Math.max(0, (cur ?? last) - 1));
          else if (e.key === 'ArrowRight') setActive((cur) => Math.min(last, (cur ?? last) + 1));
          else return;
          e.preventDefault();
        }}
        className="flex items-end gap-1 rounded-sm border-b border-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-slate-700"
        style={{ height: PLOT_PX + 18 }}
      >
        {data.weeks.map((w, i) => {
          const h = Math.round((w.count / max) * PLOT_PX);
          const current = i === last;
          return (
            <button
              key={w.start.getTime()}
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onClick={() => setActive((cur) => (cur === i ? null : i))}
              className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end focus:outline-none"
            >
              {(current || active === i) && (
                <span
                  className={`absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap ${
                    active === i
                      ? 'rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white shadow dark:bg-slate-100 dark:text-slate-900'
                      : 'text-[11px] font-semibold text-slate-700 dark:text-slate-200'
                  }`}
                  style={{ bottom: h + 4 }}
                >
                  {active === i ? (
                    <>
                      <strong className="font-semibold">{w.count} thẻ</strong>
                      <span className="opacity-75"> · {weekRange(w.start)}</span>
                    </>
                  ) : (
                    w.count
                  )}
                </span>
              )}
              <span
                className={`tf-bar-in block w-full max-w-6 rounded-t ${
                  current ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'
                } ${active === i ? 'opacity-80' : ''}`}
                style={{ height: h }}
              />
            </button>
          );
        })}
      </div>
      {/* Moc thoi gian chi ghi hai dau (8 nhan duoi 8 cot hep se chen nhau); tung tuan xem qua re chuot / bang an */}
      <div aria-hidden="true" className="mt-1 flex justify-between text-[11px] tabular-nums">
        <span className="text-slate-400 dark:text-slate-500">{ddmm(data.weeks[0].start)}</span>
        <span className="font-semibold text-slate-700 dark:text-slate-200">Tuần này</span>
      </div>

      <p className="sr-only" aria-live="polite">
        {active !== null ? `${data.weeks[active].count} thẻ, tuần ${weekRange(data.weeks[active].start)}` : ''}
      </p>

      <table className="sr-only">
        <caption>Số thẻ của bạn hoàn thành mỗi tuần, 8 tuần gần nhất</caption>
        <thead>
          <tr>
            <th scope="col">Tuần</th>
            <th scope="col">Số thẻ hoàn thành</th>
          </tr>
        </thead>
        <tbody>
          {data.weeks.map((w, i) => (
            <tr key={w.start.getTime()}>
              <th scope="row">{i === last ? `Tuần này (${weekRange(w.start)})` : weekRange(w.start)}</th>
              <td>{w.count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.withDue > 0 && (
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
          Đúng hạn {data.onTime}/{data.withDue} thẻ có hạn{' '}
          <span className="text-slate-500 dark:text-slate-400">({Math.round((data.onTime / data.withDue) * 100)}%)</span>
        </p>
      )}
    </div>
  );
}
