import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { CalendarCard, CalendarChecklistItem } from '../../lib/api/card';

export interface DayCardEntry {
  card: CalendarCard;
  // false: thẻ đang diễn ra trong ngày này nhưng hạn là ngày khác
  isDue: boolean;
}

interface Props {
  day: Date;
  isToday: boolean;
  cards: DayCardEntry[];
  checklist: CalendarChecklistItem[];
  onOpenCard: (card: CalendarCard) => void;
  onOpenChecklist: (item: CalendarChecklistItem) => void;
  onClose: () => void;
}

const ROW =
  'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700';

// Toàn bộ việc của một ngày: ô lịch chỉ chứa được vài dòng nên phần còn lại xem ở đây.
// Bấm đúp vào "+N nữa": lần bấm thứ hai rơi trúng lớp nền của hộp vừa mở và đóng nó ngay, nhìn như không có gì hiện ra.
// Trong khoảng này sau khi mở, lớp nền bỏ qua thao tác bấm (nhanh hơn nhịp đóng hộp có chủ ý của người dùng).
const BACKDROP_IGNORE_MS = 400;

export default function DayDialog({
  day,
  isToday,
  cards,
  checklist,
  onOpenCard,
  onOpenChecklist,
  onClose,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const openedAt = useRef(Date.now());

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      opener?.focus();
    };
  }, [onClose]);

  const total = cards.length + checklist.length;
  const weekdayDate = day.toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  // Trình duyệt trả về chữ thường ("thứ hai, 12 tháng 10, 2026"): chỉ viết hoa chữ đầu
  const title = weekdayDate.charAt(0).toLocaleUpperCase('vi') + weekdayDate.slice(1);

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && Date.now() - openedAt.current >= BACKDROP_IGNORE_MS) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Việc ngày ${title}`}
        className="tf-menu-in flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="flex shrink-0 items-start gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {isToday ? 'Hôm nay · ' : ''}
              {total} việc
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {total === 0 && (
            <p className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Không có việc nào trong ngày này.
            </p>
          )}

          {cards.length > 0 && (
            <ul>
              {cards.map(({ card, isDue }) => (
                <li key={card.id}>
                  <button type="button" onClick={() => onOpenCard(card)} className={ROW}>
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: card.list.board.color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-sm ${
                          card.isDone
                            ? 'text-slate-400 line-through'
                            : 'text-slate-800 dark:text-slate-100'
                        }`}
                      >
                        {card.title}
                      </span>
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                        {card.list.board.name} · {card.list.name}
                        {isDue ? '' : ' · đang diễn ra'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {checklist.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
                Mục checklist có hạn
              </p>
              <ul>
                {checklist.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => onOpenChecklist(item)} className={ROW}>
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block text-sm ${
                            item.isDone
                              ? 'text-slate-400 line-through'
                              : 'text-slate-800 dark:text-slate-100'
                          }`}
                        >
                          {item.content}
                        </span>
                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                          Thẻ “{item.checklist.card.title}” · {item.checklist.card.list.board.name}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
