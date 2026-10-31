import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  deleteSavedFilter,
  fetchSavedFilters,
  saveFilter,
  searchCardsAdvanced,
  type AssigneeFilter,
  type SavedFilter,
  type SearchCardsResult,
  type SearchFilterParams,
  type StatusFilter,
} from '../lib/api/search';
import { CARD_STATUS_ORDER, STATUS_META } from '../lib/cardStatus';
import { getErrorMessage } from '../lib/errorMessage';
import { logError } from '../lib/logError';
import { endOfLocalDayIso, startOfLocalDayIso, toLocalDateInput } from '../lib/assignDates';
import StatusBadge from '../components/board/StatusBadge';
import EmptyState from '../components/EmptyState';
import { SkeletonRegion, SkeletonRows } from '../components/Skeleton';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

const EMPTY_FILTERS: SearchFilterParams = { status: 'all' };

export default function SearchPage() {
  const [urlParams] = useSearchParams();

  const [filters, setFilters] = useState<SearchFilterParams>(() => ({
    ...EMPTY_FILTERS,
    q: urlParams.get('q') ?? undefined,
  }));
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<SearchCardsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const loadSavedFilters = useCallback(() => {
    fetchSavedFilters()
      .then(setSavedFilters)
      .catch(logError('SearchPage: tai bo loc da luu'));
  }, []);

  useEffect(() => {
    loadSavedFilters();
  }, [loadSavedFilters]);

  // Tim kiem lai khi doi bo loc (go chu debounce 400ms) hoac doi trang (ngay lap tuc)
  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      searchCardsAdvanced(filters, page)
        .then((res) => {
          setResult(res);
          setError(null);
          // Ket qua moi (doi bo loc / sang trang): danh sach tu cuon ve dau
          if (listRef.current) listRef.current.scrollTop = 0;
        })
        .catch((err) => setError(getErrorMessage(err, 'Không tìm được thẻ.')))
        .finally(() => setLoading(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [filters, page]);

  function updateFilter<K extends keyof SearchFilterParams>(
    key: K,
    value: SearchFilterParams[K]
  ) {
    setPage(1);
    setFilters((cur) => ({ ...cur, [key]: value }));
  }

  function applySavedFilter(f: SavedFilter) {
    setPage(1);
    setFilters({ status: 'all', ...f.params });
  }

  function resetFilters() {
    setPage(1);
    setFilters(EMPTY_FILTERS);
  }

  async function confirmSave() {
    const name = savingName?.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await saveFilter(name, filters);
      setSavingName(null);
      loadSavedFilters();
    } catch (err) {
      setError(getErrorMessage(err, 'Không lưu được bộ lọc.'));
    } finally {
      setBusy(false);
    }
  }

  async function removeSavedFilter(id: string) {
    const prev = savedFilters;
    setSavedFilters((cur) => cur.filter((f) => f.id !== id));
    try {
      await deleteSavedFilter(id);
    } catch (err) {
      setSavedFilters(prev);
      setError(getErrorMessage(err, 'Không xoá được bộ lọc.'));
    }
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    // Tu md: cao dung vung noi dung (MainLayout cho h-full) -> phan tren dung yen, chi danh sach ket qua (min-h-0)
    // co lai va tu cuon. min-h 32rem: khung qua thap thi quay ve cuon ca trang thay vi bop danh sach con 0.
    // Man hinh hep: bo loc chiem gan nua man hinh nen van cuon ca trang nhu cu.
    <div className="mx-auto flex max-w-3xl flex-col gap-4 md:h-full md:min-h-[32rem]">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        Tìm kiếm nâng cao
      </h1>

      {savedFilters.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {savedFilters.map((f) => (
            <span
              key={f.id}
              className="flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              <button
                type="button"
                onClick={() => applySavedFilter(f)}
                className="font-medium hover:text-primary-ink"
              >
                {f.name}
              </button>
              <button
                type="button"
                onClick={() => removeSavedFilter(f.id)}
                aria-label={`Xoá bộ lọc ${f.name}`}
                className="text-slate-400 hover:text-red-600"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
        <input
          type="text"
          aria-label="Từ khoá"
          value={filters.q ?? ''}
          onChange={(e) => updateFilter('q', e.target.value || undefined)}
          placeholder="Từ khoá (tiêu đề, mô tả)..."
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-900"
        />

        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Người phụ trách"
            value={filters.assignee ?? ''}
            onChange={(e) =>
              updateFilter(
                'assignee',
                (e.target.value || undefined) as AssigneeFilter | undefined
              )
            }
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="">Mọi người phụ trách</option>
            <option value="me">Của tôi</option>
            <option value="unassigned">Chưa giao</option>
          </select>

          <select
            aria-label="Trạng thái hoàn thành"
            value={filters.status ?? 'all'}
            onChange={(e) =>
              updateFilter('status', e.target.value as StatusFilter)
            }
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="all">Hoàn thành: tất cả</option>
            <option value="active">Chưa hoàn thành</option>
            <option value="done">Đã hoàn thành</option>
          </select>

          <input
            type="text"
            aria-label="Tên nhãn"
            value={filters.labelName ?? ''}
            onChange={(e) => updateFilter('labelName', e.target.value || undefined)}
            placeholder="Tên nhãn..."
            className="w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-900"
          />

          <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={filters.overdue ?? false}
              onChange={(e) => updateFilter('overdue', e.target.checked || undefined)}
            />
            Quá hạn
          </label>
        </div>

        {/* Trang thai cong viec: bam de bat/tat, chon nhieu (the khop 1 trong so do) */}
        <div
          role="group"
          aria-label="Lọc theo trạng thái"
          className="flex flex-wrap items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300"
        >
          <span className="mr-1">Trạng thái</span>
          {CARD_STATUS_ORDER.map((st) => {
            const on = filters.statuses?.includes(st) ?? false;
            return (
              <button
                key={st}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const cur = filters.statuses ?? [];
                  const next = on ? cur.filter((s) => s !== st) : [...cur, st];
                  updateFilter('statuses', next.length > 0 ? next : undefined);
                }}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                  on
                    ? 'border-primary bg-primary/10 text-primary-ink dark:text-blue-300'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${STATUS_META[st].dot}`} />
                {STATUS_META[st].label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <span>Hạn từ</span>
          <input
            type="date"
            aria-label="Hạn từ ngày"
            value={toLocalDateInput(filters.dueFrom ?? null)}
            onChange={(e) =>
              // Ranh gioi theo GIO DIA PHUONG (khong phai UTC): han luc 05:00 sang 21/10
              // o Viet Nam la ngay 21, khong phai ngay 20 nhu khi cat chuoi UTC
              updateFilter(
                'dueFrom',
                (e.target.value && startOfLocalDayIso(e.target.value)) || undefined
              )
            }
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
          />
          <span>đến</span>
          <input
            type="date"
            aria-label="Hạn đến ngày"
            value={toLocalDateInput(filters.dueTo ?? null)}
            onChange={(e) =>
              updateFilter(
                'dueTo',
                (e.target.value && endOfLocalDayIso(e.target.value)) || undefined
              )
            }
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
          />

          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              Xoá bộ lọc
            </button>
            {savingName === null ? (
              <button
                type="button"
                onClick={() => setSavingName('')}
                className="rounded-lg px-2 py-1 text-xs font-medium text-primary-ink hover:underline"
              >
                Lưu bộ lọc này
              </button>
            ) : (
              <span className="flex items-center gap-1">
                <input
                  autoFocus
                  value={savingName}
                  onChange={(e) => setSavingName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmSave()}
                  placeholder="Tên bộ lọc"
                  className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
                />
                <button
                  type="button"
                  disabled={busy || !savingName.trim()}
                  onClick={confirmSave}
                  className="rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  Lưu
                </button>
                <button
                  type="button"
                  onClick={() => setSavingName(null)}
                  className="rounded-lg px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Huỷ
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading && !result ? (
        <SkeletonRegion label="Đang tìm…">
          <SkeletonRows rows={5} boxed />
        </SkeletonRegion>
      ) : !result || result.items.length === 0 ? (
        <EmptyState
          icon="search"
          title="Không tìm thấy thẻ nào khớp bộ lọc."
          description="Thử bỏ bớt điều kiện hoặc đổi từ khoá."
        />
      ) : (
        <>
          <p className="text-xs text-slate-400">{result.total} kết quả</p>
          <ul
            ref={listRef}
            aria-label="Kết quả tìm kiếm"
            tabIndex={0}
            className="tf-scroll divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white focus-visible:outline-2 focus-visible:outline-primary md:min-h-0 md:overflow-y-auto md:overscroll-contain dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800"
          >
            {result.items.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/boards/${c.list.boardId}?card=${c.id}`}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <span
                    className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${
                      c.isDone
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-slate-300'
                    }`}
                  >
                    {c.isDone && (
                      <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="4">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    {c.labels.length > 0 && (
                      <span className="mb-1 flex flex-wrap gap-1">
                        {c.labels.map((l) => (
                          <span
                            key={l.labelId}
                            className="h-1.5 w-8 rounded-full"
                            style={{ backgroundColor: l.label.color }}
                          />
                        ))}
                      </span>
                    )}
                    <span
                      className={`block text-sm ${
                        c.isDone
                          ? 'text-slate-400 line-through'
                          : 'text-slate-800 dark:text-slate-100'
                      }`}
                    >
                      {c.title}
                    </span>
                    {c.status !== 'DONE' && (
                      <StatusBadge status={c.status} className="mt-1" />
                    )}
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {c.list.board.name} · {c.list.name}
                      {c.dueDate && ` · hạn ${fmtDate(c.dueDate)}`}
                      {c.members.length > 0 &&
                        ` · ${c.members.map((m) => m.user.name).join(', ')}`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-lg px-2 py-1 font-medium text-primary-ink hover:underline disabled:text-slate-300 disabled:no-underline"
              >
                Trước
              </button>
              <span className="text-slate-500">
                Trang {page}/{totalPages}
              </span>
              <button
                type="button"
                disabled={!result.hasMore}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg px-2 py-1 font-medium text-primary-ink hover:underline disabled:text-slate-300 disabled:no-underline"
              >
                Sau
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
