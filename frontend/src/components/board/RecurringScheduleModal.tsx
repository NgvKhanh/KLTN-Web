import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { fetchCardTemplates } from '../../lib/api/cardTemplate';
import {
  createRecurringSchedule,
  deleteRecurringSchedule,
  fetchRecurringSchedules,
  updateRecurringSchedule,
  type RecurrenceFrequency,
  type RecurringSchedule,
} from '../../lib/api/recurringSchedule';
import { getErrorMessage } from '../../lib/errorMessage';
import { logError } from '../../lib/logError';
import type { CardTemplate } from '../../types/cardTemplate';
import { SkeletonRegion, SkeletonRows } from '../Skeleton';

interface Props {
  listId: string;
  boardId: string;
  onClose: () => void;
}

const WEEKDAY_LABEL = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

function fmtDateTimeUTC(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
}

function describeFrequency(s: {
  frequency: RecurrenceFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timeOfDay: string;
}): string {
  if (s.frequency === 'DAILY') return `Hằng ngày lúc ${s.timeOfDay} (UTC)`;
  if (s.frequency === 'WEEKLY')
    return `Hằng tuần vào ${WEEKDAY_LABEL[s.dayOfWeek ?? 0]} lúc ${s.timeOfDay} (UTC)`;
  return `Hằng tháng vào ngày ${s.dayOfMonth} lúc ${s.timeOfDay} (UTC)`;
}

export default function RecurringScheduleModal({ listId, boardId, onClose }: Props) {
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([]);
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('DAILY');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [cardTemplateId, setCardTemplateId] = useState('');
  const [endDate, setEndDate] = useState('');

  function load() {
    setLoading(true);
    Promise.all([fetchRecurringSchedules(listId), fetchCardTemplates(boardId)])
      .then(([s, t]) => {
        setSchedules(s);
        setTemplates(t);
      })
      .catch((err) => setError(getErrorMessage(err, 'Không tải được lịch.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, boardId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createRecurringSchedule(listId, {
        title: title.trim(),
        frequency,
        dayOfWeek: frequency === 'WEEKLY' ? dayOfWeek : undefined,
        dayOfMonth: frequency === 'MONTHLY' ? dayOfMonth : undefined,
        timeOfDay,
        cardTemplateId: cardTemplateId || undefined,
        endDate: endDate ? `${endDate}T23:59:59.000Z` : undefined,
      });
      setTitle('');
      setEndDate('');
      setCardTemplateId('');
      load();
    } catch (err) {
      setError(getErrorMessage(err, 'Không tạo được lịch.'));
    } finally {
      setBusy(false);
    }
  }

  async function togglePause(s: RecurringSchedule) {
    const prev = schedules;
    setSchedules((cur) =>
      cur.map((x) => (x.id === s.id ? { ...x, isPaused: !x.isPaused } : x))
    );
    try {
      await updateRecurringSchedule(s.id, { isPaused: !s.isPaused });
    } catch (err) {
      setSchedules(prev);
      logError('RecurringScheduleModal: doi trang thai tam dung')(err);
    }
  }

  async function remove(s: RecurringSchedule) {
    const prev = schedules;
    setSchedules((cur) => cur.filter((x) => x.id !== s.id));
    try {
      await deleteRecurringSchedule(s.id);
    } catch (err) {
      setSchedules(prev);
      setError(getErrorMessage(err, 'Không xoá được lịch.'));
    }
  }

  const field =
    'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-900';
  const label = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300';

  return createPortal(
    <div
      className="tf-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-800 dark:text-slate-100"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-sm font-semibold">Thẻ định kỳ trong danh sách này</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

          <form onSubmit={submitCreate} className="mb-5 flex flex-col gap-2.5 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div>
              <label className={label}>Tiêu đề thẻ</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="VD: Báo cáo tuần"
                className={field}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>Lặp lại</label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
                  className={field}
                >
                  <option value="DAILY">Hằng ngày</option>
                  <option value="WEEKLY">Hằng tuần</option>
                  <option value="MONTHLY">Hằng tháng</option>
                </select>
              </div>
              <div>
                <label className={label}>Giờ tạo thẻ (UTC)</label>
                <input
                  type="time"
                  value={timeOfDay}
                  onChange={(e) => setTimeOfDay(e.target.value)}
                  className={field}
                />
              </div>
            </div>

            {frequency === 'WEEKLY' && (
              <div>
                <label className={label}>Vào thứ</label>
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  className={field}
                >
                  {WEEKDAY_LABEL.map((l, i) => (
                    <option key={i} value={i}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {frequency === 'MONTHLY' && (
              <div>
                <label className={label}>Vào ngày (1-31, quá cuối tháng lấy ngày cuối)</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Number(e.target.value))}
                  className={field}
                />
              </div>
            )}

            {templates.length > 0 && (
              <div>
                <label className={label}>Dùng mẫu thẻ (tuỳ chọn)</label>
                <select
                  value={cardTemplateId}
                  onChange={(e) => setCardTemplateId(e.target.value)}
                  className={field}
                >
                  <option value="">Không dùng mẫu</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className={label}>Ngày dừng (tuỳ chọn)</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={field}
              />
            </div>

            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="rounded-lg bg-primary py-1.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {busy ? 'Đang tạo...' : 'Tạo lịch'}
            </button>
          </form>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Các lịch đã tạo
          </p>
          {loading ? (
            <SkeletonRegion label="Đang tải lịch lặp…">
              <SkeletonRows rows={2} />
            </SkeletonRegion>
          ) : schedules.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Danh sách này chưa có lịch tạo thẻ định kỳ nào.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {schedules.map((s) => {
                const ended = s.endDate ? new Date(s.endDate).getTime() < Date.now() : false;
                return (
                  <li
                    key={s.id}
                    className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{s.title}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {describeFrequency(s)}
                        </p>
                        <p className="text-xs text-slate-400">
                          {ended
                            ? `Đã kết thúc (${fmtDateTimeUTC(s.endDate!)})`
                            : s.isPaused
                              ? 'Đang tạm dừng'
                              : `Lần tạo kế tiếp: ${fmtDateTimeUTC(s.nextRunAt)}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {!ended && (
                          <button
                            type="button"
                            onClick={() => togglePause(s)}
                            className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            {s.isPaused ? 'Tiếp tục' : 'Tạm dừng'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => remove(s)}
                          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                        >
                          Xoá
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
