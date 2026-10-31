import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchBoardLabels } from '../../lib/api/card';
import { logError } from '../../lib/logError';
import { initialsOf } from '../../lib/avatar';
import { CARD_STATUS_ORDER, STATUS_META } from '../../lib/cardStatus';
import {
  EMPTY_FILTER,
  isFilterActive,
  type BoardFilter,
} from '../../lib/boardFilter';
import type { BoardMember } from '../../types/board';
import type { Label } from '../../types/card';

interface Props {
  boardId: string;
  filter: BoardFilter;
  onChange: (next: BoardFilter) => void;
  boardMembers: BoardMember[];
  onClose: () => void;
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function Check({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
          checked
            ? 'border-primary bg-primary text-white'
            : 'border-slate-300 dark:border-slate-600'
        }`}
      >
        {checked && (
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 mt-3 px-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
      {children}
    </p>
  );
}

export default function BoardFilterPanel({
  boardId,
  filter,
  onChange,
  boardMembers,
  onClose,
}: Props) {
  const [labels, setLabels] = useState<Label[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<BoardFilter>) => onChange({ ...filter, ...patch });

  useEffect(() => {
    fetchBoardLabels(boardId)
      .then(setLabels)
      .catch(logError('BoardFilterPanel: tai nhan'));
  }, [boardId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (
        ref.current &&
        !ref.current.contains(t) &&
        !t.closest('[data-filter-trigger]')
      ) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="tf-menu-in fixed right-3 top-14 z-50 w-72 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-800 dark:text-slate-100 shadow-2xl"
    >
      <div className="flex items-center px-1.5 pb-1">
        <p className="flex-1 text-center text-sm font-semibold">Lọc</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          className="rounded p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto">
        <SectionTitle>Từ khoá</SectionTitle>
        <div className="px-1.5">
          <input
            value={filter.keyword}
            onChange={(e) => set({ keyword: e.target.value })}
            placeholder="Nhập từ khoá..."
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
          />
          <p className="pt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Tìm trong tên và mô tả thẻ.
          </p>
        </div>

        <SectionTitle>Thành viên</SectionTitle>
        <Check
          checked={filter.noMembers}
          onClick={() => set({ noMembers: !filter.noMembers })}
        >
          Không có thành viên
        </Check>
        <Check
          checked={filter.assignedToMe}
          onClick={() => set({ assignedToMe: !filter.assignedToMe })}
        >
          Các thẻ đã chỉ định cho tôi
        </Check>
        {boardMembers.map((m) => (
          <Check
            key={m.userId}
            checked={filter.memberIds.includes(m.userId)}
            onClick={() =>
              set({ memberIds: toggle(filter.memberIds, m.userId) })
            }
          >
            <span className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#7f5ad5] text-[10px] font-semibold text-white">
                {initialsOf(m.user.name)}
              </span>
              <span className="truncate">{m.user.name}</span>
            </span>
          </Check>
        ))}

        <SectionTitle>Trạng thái</SectionTitle>
        {CARD_STATUS_ORDER.map((st) => (
          <Check
            key={st}
            checked={filter.statuses.includes(st)}
            onClick={() => set({ statuses: toggle(filter.statuses, st) })}
          >
            <span className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_META[st].dot}`} />
              {STATUS_META[st].label}
            </span>
          </Check>
        ))}

        <SectionTitle>Hoàn thành</SectionTitle>
        <Check
          checked={filter.complete}
          onClick={() => set({ complete: !filter.complete })}
        >
          Đã đánh dấu hoàn thành
        </Check>
        <Check
          checked={filter.incomplete}
          onClick={() => set({ incomplete: !filter.incomplete })}
        >
          Chưa đánh dấu hoàn thành
        </Check>

        <SectionTitle>Ngày hết hạn</SectionTitle>
        <Check
          checked={filter.dueNone}
          onClick={() => set({ dueNone: !filter.dueNone })}
        >
          Không có ngày
        </Check>
        <Check
          checked={filter.dueOverdue}
          onClick={() => set({ dueOverdue: !filter.dueOverdue })}
        >
          Quá hạn
        </Check>
        <Check
          checked={filter.dueTomorrow}
          onClick={() => set({ dueTomorrow: !filter.dueTomorrow })}
        >
          Đến hạn trong ngày mai
        </Check>
        <Check
          checked={filter.dueWeek}
          onClick={() => set({ dueWeek: !filter.dueWeek })}
        >
          Đến hạn trong tuần
        </Check>

        {labels.length > 0 && (
          <>
            <SectionTitle>Nhãn</SectionTitle>
            {labels.map((l) => (
              <Check
                key={l.id}
                checked={filter.labelIds.includes(l.id)}
                onClick={() => set({ labelIds: toggle(filter.labelIds, l.id) })}
              >
                <span className="flex items-center gap-2">
                  <span
                    className="h-5 w-10 shrink-0 rounded"
                    style={{ backgroundColor: l.color }}
                  />
                  <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {l.name || 'Không tên'}
                  </span>
                </span>
              </Check>
            ))}
          </>
        )}
      </div>

      {isFilterActive(filter) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTER)}
          className="mt-1 w-full rounded-lg bg-slate-100 dark:bg-slate-700 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
        >
          Xoá bộ lọc
        </button>
      )}
    </div>,
    document.body
  );
}
