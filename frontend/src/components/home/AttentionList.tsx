import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { MyCard } from '../../lib/api/card';
import { BUCKET_LABEL, attentionGroups, dueNote, type AttentionBucket, type DueTone } from '../../lib/myCards';
import EmptyState from '../EmptyState';

// Moi nhom chi hien vai the dau (gan han nhat), phan con lai xem o trang "Cong viec cua toi"
export const ATTENTION_PER_GROUP = 5;

const TONE_CLASS: Record<DueTone, string> = {
  danger: 'text-red-700 dark:text-red-300',
  warn: 'text-amber-700 dark:text-amber-300',
  muted: 'text-slate-500 dark:text-slate-400',
};

const BUCKET_DOT: Record<AttentionBucket, string> = {
  overdue: 'bg-red-500',
  today: 'bg-amber-500',
  week: 'bg-primary',
};

function fmtDue(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Props {
  cards: MyCard[];
  now: Date;
  /** The vua tick tren trang: van giu trong danh sach (gach ngang) de bo tick lai duoc. */
  keepIds: ReadonlySet<string>;
  onToggleDone: (card: MyCard) => void;
}

export default function AttentionList({ cards, now, keepIds, onToggleDone }: Props) {
  const groups = useMemo(() => attentionGroups(cards, now, keepIds), [cards, now, keepIds]);

  if (groups.length === 0) {
    return (
      <EmptyState
        compact
        icon="calendar"
        title="Không có thẻ nào sắp đến hạn."
        description="Việc gần hạn của bạn đã xử lý xong."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ bucket, items }) => {
        const more = items.length - ATTENTION_PER_GROUP;
        return (
          <section key={bucket} aria-label={BUCKET_LABEL[bucket]}>
            <h3 className="mb-1 flex items-center gap-2 px-2 text-xs font-medium">
              <span className={`h-2 w-2 shrink-0 rounded-full ${BUCKET_DOT[bucket]}`} aria-hidden="true" />
              <span className={bucket === 'overdue' ? 'text-red-700 dark:text-red-300' : 'text-slate-700 dark:text-slate-200'}>
                {BUCKET_LABEL[bucket]}
              </span>
              <span className="text-slate-500 dark:text-slate-400">{items.length}</span>
            </h3>
            <ul className="flex flex-col">
              {items.slice(0, ATTENTION_PER_GROUP).map((c) => {
                const note = c.isDone ? null : dueNote(c.dueDate, now);
                const dueText = c.isDone ? 'Đã xong' : note?.text;
                const dueClass = c.isDone
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : TONE_CLASS[note?.tone ?? 'muted'];
                const dueTitle = c.dueDate ? `Hạn: ${fmtDue(c.dueDate)}` : undefined;
                return (
                  <li
                    key={c.id}
                    className="relative flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-100 dark:hover:bg-slate-700/60"
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={c.isDone}
                      aria-label={c.isDone ? `Mở lại thẻ ${c.title}` : `Đánh dấu hoàn thành thẻ ${c.title}`}
                      onClick={() => onToggleDone(c)}
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

                    <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                      <Link
                        to={`/boards/${c.list.boardId}?card=${c.id}`}
                        className={`block min-w-0 truncate text-sm after:absolute after:inset-0 after:rounded-lg focus-visible:outline-2 focus-visible:outline-primary sm:flex-1 ${
                          c.isDone ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100'
                        }`}
                      >
                        {c.title}
                      </Link>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 sm:mt-0 sm:max-w-[40%]">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                          style={{ backgroundColor: c.list.board.color }}
                        />
                        <span className="truncate">{c.list.board.name}</span>
                        {/* Man hinh hep: han nam cung dong voi ten bang de ten the duoc ca chieu ngang */}
                        <span title={dueTitle} className={`ml-auto shrink-0 pl-2 tabular-nums sm:hidden ${dueClass}`}>
                          {dueText}
                        </span>
                      </span>
                    </div>

                    <span
                      title={dueTitle}
                      className={`mt-0.5 hidden w-28 shrink-0 text-right text-xs tabular-nums sm:block ${dueClass}`}
                    >
                      {dueText}
                    </span>
                  </li>
                );
              })}
            </ul>
            {more > 0 && (
              <Link to="/my-cards" className="ml-9 mt-1 inline-block text-xs font-medium text-primary-ink hover:underline">
                +{more} thẻ nữa
              </Link>
            )}
          </section>
        );
      })}
    </div>
  );
}
