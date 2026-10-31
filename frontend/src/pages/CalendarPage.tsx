import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  fetchCalendarCards,
  updateCard,
  type CalendarCard,
  type CalendarChecklistItem,
} from '../lib/api/card';
import { getErrorMessage } from '../lib/errorMessage';
import DayDialog from '../components/calendar/DayDialog';

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MONTHS = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];

type ViewMode = 'month' | 'week';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

// Thu 2 dau tuan: 0=T2 ... 6=CN
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function startOfWeek(d: Date): Date {
  const s = new Date(d);
  s.setDate(d.getDate() - mondayIndex(d));
  s.setHours(0, 0, 0, 0);
  return s;
}

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

// Cac ngay (theo key ymd) ma 1 the "phu song" - tu startDate (hoac dueDate
// neu khong dat startDate) toi dueDate. So sanh chuoi YYYY-MM-DD an toan vi
// cung do dai, cung dinh dang.
function cardDayKeys(c: CalendarCard): { from: string; to: string } {
  const due = ymd(new Date(c.dueDate));
  const start = c.startDate ? ymd(new Date(c.startDate)) : due;
  return start <= due ? { from: start, to: due } : { from: due, to: due };
}

interface DraggableChipProps {
  card: CalendarCard;
  isDue: boolean;
  onOpen: () => void;
}

function CardChip({ card, isDue, onOpen }: DraggableChipProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `card:${card.id}`,
  });
  const style = transform
    ? { transform: CSS.Translate.toString(transform), zIndex: 20 }
    : undefined;

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      type="button"
      onClick={onOpen}
      title={`${card.title} — ${card.list.board.name}${isDue ? '' : ' (đang diễn ra)'}`}
      className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] ${
        isDragging ? 'opacity-40' : ''
      } ${
        card.isDone ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200'
      } ${isDue ? 'hover:bg-slate-100 dark:hover:bg-slate-700' : 'opacity-70 hover:opacity-100'}`}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: card.list.board.color }}
      />
      {!isDue && <span className="shrink-0 text-slate-400">→</span>}
      <span className="truncate">{card.title}</span>
    </button>
  );
}

function ChecklistChip({ item, onOpen }: { item: CalendarChecklistItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${item.content} — thẻ "${item.checklist.card.title}"`}
      className={`flex w-full items-center gap-1 truncate rounded border border-dashed border-slate-300 px-1 py-0.5 text-left text-[11px] dark:border-slate-600 ${
        item.isDone ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-slate-300'
      } hover:bg-slate-100 dark:hover:bg-slate-700`}
    >
      <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M5 13l4 4L19 7" />
      </svg>
      <span className="truncate">{item.content}</span>
    </button>
  );
}

function DayCell({
  dayKey,
  children,
}: {
  dayKey: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dayKey}` });
  return (
    <div ref={setNodeRef} className={isOver ? 'bg-primary-soft dark:bg-primary/20' : ''}>
      {children}
    </div>
  );
}

export default function CalendarPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ViewMode>('month');
  const [anchor, setAnchor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [cards, setCards] = useState<CalendarCard[]>([]);
  const [checklistItems, setChecklistItems] = useState<CalendarChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  // Ngày (key ymd) đang mở hộp xem đủ việc; null = đóng
  const [openDay, setOpenDay] = useState<string | null>(null);
  const closeDay = useCallback(() => setOpenDay(null), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const gridStart = useMemo(() => {
    if (mode === 'week') return startOfWeek(anchor);
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    return startOfWeek(first);
  }, [anchor, mode]);

  const dayCount = mode === 'week' ? 7 : 42;

  const days = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, i) => {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        return d;
      }),
    [gridStart, dayCount]
  );

  function load() {
    setLoading(true);
    setError(null);
    const from = new Date(gridStart);
    const to = new Date(gridStart);
    to.setDate(to.getDate() + dayCount);
    fetchCalendarCards(from.toISOString(), to.toISOString())
      .then((data) => {
        setCards(data.cards);
        setChecklistItems(data.checklistItems);
      })
      .catch((err) => setError(getErrorMessage(err, 'Không tải được lịch.')))
      .finally(() => setLoading(false));
  }

  useEffect(load, [gridStart, dayCount]);

  const byDay = useMemo(() => {
    const m = new Map<string, { card: CalendarCard; isDue: boolean }[]>();
    const dayKeys = days.map(ymd);
    for (const c of cards) {
      const { from, to } = cardDayKeys(c);
      const dueKey = ymd(new Date(c.dueDate));
      for (const k of dayKeys) {
        if (k < from || k > to) continue;
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push({ card: c, isDue: k === dueKey });
      }
    }
    return m;
  }, [cards, days]);

  const checklistByDay = useMemo(() => {
    const m = new Map<string, CalendarChecklistItem[]>();
    for (const it of checklistItems) {
      const key = ymd(new Date(it.dueDate));
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(it);
    }
    return m;
  }, [checklistItems]);

  const todayKey = ymd(new Date());
  // Cột thứ của hôm nay (chỉ khi hôm nay nằm trong khoảng đang xem)
  const todayColumn = days.some((d) => ymd(d) === todayKey) ? mondayIndex(new Date()) : -1;
  const shift = (delta: number) => {
    if (mode === 'week') {
      setAnchor((a) => {
        const n = new Date(a);
        n.setDate(n.getDate() + delta * 7);
        return n;
      });
    } else {
      setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + delta, 1));
    }
  };
  const goToday = () => {
    const n = new Date();
    setAnchor(mode === 'week' ? n : new Date(n.getFullYear(), n.getMonth(), 1));
  };

  function openCard(c: CalendarCard) {
    navigate(`/boards/${c.list.boardId}?card=${c.id}`);
  }
  function openChecklistCard(it: CalendarChecklistItem) {
    navigate(`/boards/${it.checklist.card.list.boardId}?card=${it.checklist.card.id}`);
  }

  function handleDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || !activeId.startsWith('card:') || !overId.startsWith('day:')) return;
    const cardId = activeId.slice('card:'.length);
    const dayKey = overId.slice('day:'.length);
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    const oldDue = new Date(card.dueDate);
    if (ymd(oldDue) === dayKey) return; // tha lai dung ngay cu

    const [y, mo, d] = dayKey.split('-').map(Number);
    const newDue = new Date(oldDue);
    newDue.setFullYear(y, mo - 1, d);
    const deltaMs = newDue.getTime() - oldDue.getTime();
    const newStartIso = card.startDate
      ? new Date(new Date(card.startDate).getTime() + deltaMs).toISOString()
      : undefined;

    setMoving(true);
    setError(null);
    updateCard(cardId, {
      dueDate: newDue.toISOString(),
      ...(newStartIso ? { startDate: newStartIso } : {}),
    })
      .then(load)
      .catch((err) => setError(getErrorMessage(err, 'Không đổi được hạn.')))
      .finally(() => setMoving(false));
  }

  // Đổi tháng/tuần khiến ngày đang mở không còn trong lưới thì hộp tự đóng
  const openDayDate = openDay ? days.find((d) => ymd(d) === openDay) : undefined;

  const title =
    mode === 'week'
      ? `${fmtShort(days[0].toISOString())} – ${fmtShort(days[6].toISOString())}`
      : `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="min-w-[10rem] flex-1 whitespace-nowrap text-lg font-semibold text-slate-900 dark:text-slate-100">
          Lịch — {title}
        </h1>

        <div className="flex rounded-lg border border-slate-300 text-sm dark:border-slate-600">
          <button
            type="button"
            onClick={() => setMode('month')}
            className={`rounded-l-lg px-2.5 py-1 ${
              mode === 'month'
                ? 'bg-primary text-white'
                : 'hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            Tháng
          </button>
          <button
            type="button"
            onClick={() => setMode('week')}
            className={`rounded-r-lg px-2.5 py-1 ${
              mode === 'week'
                ? 'bg-primary text-white'
                : 'hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            Tuần
          </button>
        </div>

        <button
          type="button"
          onClick={() => shift(-1)}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={goToday}
          className="rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
        >
          Hôm nay
        </button>
        <button
          type="button"
          onClick={() => shift(1)}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
        >
          ›
        </button>
      </div>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {(loading || moving) && (
        <p role="status" className="mb-2 text-sm text-slate-400">{moving ? 'Đang cập nhật...' : 'Đang tải...'}</p>
      )}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {/* Màn hình hẹp: lịch cuộn ngang trong vùng riêng để mỗi ô đủ rộng đọc được tên thẻ */}
        <div className="overflow-x-auto rounded-xl">
        <div className="grid min-w-[640px] grid-cols-7 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-700 dark:bg-slate-800">
          {WEEKDAYS.map((w, col) => (
            <div
              key={w}
              className={`border-b border-slate-200 bg-slate-50 py-1.5 text-center text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 ${
                col === todayColumn
                  ? 'text-primary-ink'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {w}
            </div>
          ))}
          {days.map((d, i) => {
            const key = ymd(d);
            const inMonth = mode === 'week' || d.getMonth() === anchor.getMonth();
            const isToday = key === todayKey;
            const dayCards = byDay.get(key) ?? [];
            const dayChecklist = checklistByDay.get(key) ?? [];
            const total = dayCards.length + dayChecklist.length;
            // Thẻ và mục checklist chung một danh sách, cắt đúng số dòng ô chứa được;
            // phần còn lại (hidden) xem trong hộp của ngày.
            const entries = [
              ...dayCards.map((e) => ({ kind: 'card' as const, ...e })),
              ...dayChecklist.map((item) => ({ kind: 'item' as const, item })),
            ];
            const visibleCount = mode === 'week' ? 8 : 3;
            const hidden = total - visibleCount;
            const numberClass = `grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs ${
              isToday
                ? 'bg-primary font-semibold text-white'
                : inMonth
                  ? 'text-slate-500 dark:text-slate-400'
                  : 'text-slate-300 dark:text-slate-600'
            }`;
            const dayLabel = `${d.getDate()}/${d.getMonth() + 1}`;
            return (
              <DayCell key={i} dayKey={key}>
                <div
                  className={`${mode === 'week' ? 'min-h-[220px]' : 'min-h-[92px]'} border-b border-r border-slate-100 p-1 dark:border-slate-700/60 ${
                    isToday
                      ? 'bg-primary-soft'
                      : inMonth
                        ? ''
                        : 'bg-slate-50/60 dark:bg-slate-900/40'
                  }`}
                >
                  <div className="mb-1 flex justify-end">
                    {total > 0 ? (
                      <button
                        type="button"
                        onClick={() => setOpenDay(key)}
                        aria-label={`Xem ${total} việc ngày ${dayLabel}`}
                        aria-current={isToday ? 'date' : undefined}
                        className={`${numberClass} ${
                          isToday
                            ? 'hover:bg-primary-hover'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        {d.getDate()}
                      </button>
                    ) : (
                      <span aria-current={isToday ? 'date' : undefined} className={numberClass}>
                        {d.getDate()}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {entries.slice(0, visibleCount).map((entry) =>
                      entry.kind === 'card' ? (
                        <CardChip
                          key={`c:${entry.card.id}`}
                          card={entry.card}
                          isDue={entry.isDue}
                          onOpen={() => openCard(entry.card)}
                        />
                      ) : (
                        <ChecklistChip
                          key={`i:${entry.item.id}`}
                          item={entry.item}
                          onOpen={() => openChecklistCard(entry.item)}
                        />
                      )
                    )}
                    {hidden > 0 && (
                      <button
                        type="button"
                        onClick={() => setOpenDay(key)}
                        aria-label={`Xem thêm ${hidden} việc ngày ${dayLabel}`}
                        className="rounded px-1 py-0.5 text-left text-[11px] font-medium text-primary-ink hover:bg-primary-soft hover:underline dark:hover:bg-slate-700"
                      >
                        +{hidden} nữa
                      </button>
                    )}
                  </div>
                </div>
              </DayCell>
            );
          })}
        </div>
        </div>
      </DndContext>
      <p className="mt-2 text-xs text-slate-400">
        Kéo một thẻ sang ngày khác để đổi hạn. Bấm số ngày hoặc "+N nữa" để xem đủ việc của ngày đó. Thẻ có mũi tên "→" là đang diễn ra (chưa tới hạn); viền nét đứt là mục checklist có hạn.
      </p>

      {openDayDate && (
        <DayDialog
          day={openDayDate}
          isToday={openDay === todayKey}
          cards={byDay.get(openDay ?? '') ?? []}
          checklist={checklistByDay.get(openDay ?? '') ?? []}
          onOpenCard={openCard}
          onOpenChecklist={openChecklistCard}
          onClose={closeDay}
        />
      )}
    </div>
  );
}
