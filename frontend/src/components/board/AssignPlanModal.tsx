import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchAssignPlan } from '../../lib/api/assign';
import { addCardMember } from '../../lib/api/card';
import { formatViDate } from '../../lib/assignDates';
import {
  applySelection,
  distribution,
  initialIncluded,
  initialPicks,
  optionLabel,
  rowWarning,
  selectedRows,
  type ApplyFailure,
  type PlanPicks,
} from '../../lib/assignPlan';
import { COMPONENT_HINT, COMPONENT_LABEL, COMPONENT_SHORT, flagLabel } from '../../lib/assignLabels';
import { WEIGHT_KEYS } from '../../lib/assignWeights';
import { getErrorMessage } from '../../lib/errorMessage';
import type { AssignPlanResult, AssignPlanRow } from '../../types/assign';
import Avatar from '../Avatar';

// Chia viec cho CA DANH SACH (lop 2, ASSIGN_MODULE.md §10.10): may chu de xuat, nguoi dung xem truoc, sua tung dong roi moi
// ap dung. Ban de xuat KHONG duoc luu o may chu; ap dung = giao tung the bang API giao the co san (addCardMember).

interface Props {
  listId: string;
  listName: string;
  onClose: () => void;
  /** Goi sau khi da giao it nhat mot the (de bang tai lai). */
  onApplied: () => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: AssignPlanResult }
  | { status: 'error'; message: string };

// React.StrictMode (dev) chay effect hai lan lien nhau; may chu gioi han 10 luot / 10 phut, nen dung chung yeu cau dang bay
const inflight = new Map<string, Promise<AssignPlanResult>>();
function loadOnce(listId: string): Promise<AssignPlanResult> {
  let p = inflight.get(listId);
  if (!p) {
    p = fetchAssignPlan(listId).finally(() => inflight.delete(listId));
    inflight.set(listId, p);
  }
  return p;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const NO_ROWS: readonly AssignPlanRow[] = [];

const BADGE = 'rounded px-1.5 py-0.5 text-[10px] font-medium';
const WARN_BADGE = `${BADGE} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200`;
const PLAIN_BADGE = `${BADGE} bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300`;

export default function AssignPlanModal({ listId, listName, onClose, onApplied }: Props) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [picks, setPicks] = useState<PlanPicks>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<ApplyFailure[]>([]);
  const appliedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    loadOnce(listId)
      .then((data) => {
        if (!alive) return;
        setPicks(initialPicks(data.rows));
        setIncluded(initialIncluded(data.rows));
        setState({ status: 'ready', data });
      })
      .catch((err) => {
        if (alive) setState({ status: 'error', message: getErrorMessage(err, 'Chưa tính được kế hoạch lúc này.') });
      });
    return () => {
      alive = false;
    };
  }, [listId, reloadKey]);

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  // Da giao it nhat mot the ma van dong (con the loi) -> bao bang tai lai
  const close = useCallback(() => {
    if (appliedRef.current) onApplied();
    onClose();
  }, [onApplied, onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !applying) close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [applying, close]);

  const data = state.status === 'ready' ? state.data : null;
  const rows = data?.rows ?? NO_ROWS;
  // Con phai giao (khong tinh the da giao xong) va TOAN BO the da chon (ke ca the da giao xong: chung van la viec cua nguoi do)
  const selection = useMemo(() => selectedRows(rows, picks, included, done), [rows, picks, included, done]);
  const planned = useMemo(() => selectedRows(rows, picks, included), [rows, picks, included]);
  const shares = useMemo(() => (data ? distribution(data.people, planned) : []), [data, planned]);
  const nameOf = useMemo(() => new Map((data?.people ?? []).map((p) => [p.user.id, p.user.name])), [data]);
  const risky = selection.filter((s) => {
    const row = rows.find((r) => r.card.id === s.cardId);
    return row ? rowWarning(row, s.userId, nameOf.get(s.userId) ?? '') !== null : false;
  }).length;

  async function apply() {
    if (applying || selection.length === 0) return;
    setApplying(true);
    setFailures([]);
    try {
      const result = await applySelection(
        selection,
        addCardMember,
        (err) => getErrorMessage(err, 'Không giao được thẻ này.'),
        (cardId) => {
          appliedRef.current = true;
          setDone((prev) => new Set(prev).add(cardId));
        }
      );
      setFailures(result.failed);
      if (result.failed.length === 0) {
        onApplied();
        onClose();
      }
    } finally {
      setApplying(false);
    }
  }

  function renderRow(row: AssignPlanRow) {
    const cardId = row.card.id;
    const userId = picks[cardId] ?? null;
    const isDone = done.has(cardId);
    const failure = failures.find((f) => f.cardId === cardId);
    const warning = rowWarning(row, userId, nameOf.get(userId ?? '') ?? '');
    const isSuggested = userId !== null && row.assignee?.user.id === userId;
    const ranking = row.ranking.find((r) => r.userId === userId);
    return (
      <li key={cardId} data-testid={`plan-row-${cardId}`} className="rounded border border-slate-200 p-2 dark:border-slate-700">
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            aria-label={`Chọn thẻ ${row.card.title}`}
            checked={included[cardId] ?? false}
            disabled={isDone || applying || userId === null}
            onChange={(e) => setIncluded((prev) => ({ ...prev, [cardId]: e.target.checked }))}
            className="mt-1 h-4 w-4 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="grid h-4 min-w-4 place-items-center rounded bg-slate-200 px-1 text-[10px] font-semibold text-slate-700 dark:bg-slate-600 dark:text-slate-100">
                {row.order}
              </span>
              <span className="truncate text-sm font-medium">{row.card.title}</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {row.card.dueDate ? `Hạn ${formatViDate(row.card.dueDate)}` : 'Không có hạn'}
              </span>
              {isDone && <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Đã giao</span>}
            </p>
            <div className="mt-1 flex items-center gap-2">
              {userId !== null && (
                <Avatar id={userId} name={nameOf.get(userId) ?? ''} avatarUrl={data?.people.find((p) => p.user.id === userId)?.user.avatarUrl ?? null} />
              )}
              <select
                aria-label={`Người nhận thẻ ${row.card.title}`}
                value={userId ?? ''}
                disabled={isDone || applying}
                onChange={(e) => {
                  const next = e.target.value === '' ? null : e.target.value;
                  setPicks((prev) => ({ ...prev, [cardId]: next }));
                  setIncluded((prev) => ({ ...prev, [cardId]: next !== null }));
                }}
                className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="">— Không giao —</option>
                {row.ranking.map((r) => (
                  <option key={r.userId} value={r.userId}>
                    {optionLabel(nameOf.get(r.userId) ?? r.userId, r)}
                  </option>
                ))}
              </select>
            </div>
            {userId !== null && ranking && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                {ranking.score !== null ? <span title="Điểm tương đối trong nhóm ứng viên của thẻ này, tại bước này">Phù hợp {Math.round(ranking.score)}</span> : <span>Chưa đủ dữ liệu để chấm</span>}
                <span>Tải {ranking.load}/{ranking.capacity}</span>
                {isSuggested &&
                  row.assignee &&
                  WEIGHT_KEYS.map((k) => {
                    const v = row.assignee!.components[k].value;
                    return (
                      <span key={k} title={`${COMPONENT_LABEL[k]}: ${COMPONENT_HINT[k]}`}>
                        {COMPONENT_SHORT[k]} {v === null ? '—' : pct(v)}
                      </span>
                    );
                  })}
                {ranking.flags.map((f) => (
                  <span key={f} className={f === 'OVERLOADED' || f === 'PAUSED' ? WARN_BADGE : PLAIN_BADGE}>
                    {flagLabel(f, ranking)}
                  </span>
                ))}
              </p>
            )}
            {userId === null && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{row.assignee === null ? 'Không có ai phù hợp lúc này (mọi người đang tạm nghỉ) — thẻ để trống.' : 'Không giao thẻ này.'}</p>}
            {warning && !isDone && <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-200">{warning}</p>}
            {failure && (
              <p role="alert" className="mt-1 text-[11px] text-red-600">
                Không giao được: {failure.message}
              </p>
            )}
          </div>
        </div>
      </li>
    );
  }

  return createPortal(
    <div className="tf-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]" onClick={() => !applying && close()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-plan-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-800 dark:text-slate-100"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 id="assign-plan-title" className="text-sm font-semibold">
            Chia việc gợi ý — {listName}
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={applying}
            aria-label="Đóng"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-3 text-xs leading-snug text-slate-600 dark:text-slate-300">
            Các thẻ chưa có người nhận được xếp <b>hạn gấp trước</b>. Mỗi thẻ được gợi ý cho người phù hợp nhất theo lịch sử làm việc; thẻ vừa chia được tính vào
            tải của người đó cho các thẻ sau. Bạn xem, đổi người hoặc bỏ tick từng thẻ — chỉ khi bấm <b>Áp dụng</b> thì mới giao thật. KN = kinh nghiệm · TC = độ tin cậy · KD = khả dụng · HS = hồ sơ tự khai.
          </p>

          {state.status === 'loading' && (
            <div role="status" aria-live="polite" className="space-y-1.5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Đang tính kế hoạch dựa trên lịch sử làm việc…</p>
              <div className="h-14 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
              <div className="h-14 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
            </div>
          )}

          {state.status === 'error' && (
            <div className="rounded bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-700/50 dark:text-slate-200">
              <p>{state.message}</p>
              <button
                type="button"
                onClick={() => {
                  setState({ status: 'loading' });
                  setReloadKey((k) => k + 1);
                }}
                className="mt-1 font-medium text-primary-ink hover:underline"
              >
                Thử lại
              </button>
            </div>
          )}

          {data && data.rows.length === 0 && (
            <p className="rounded bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-700/50 dark:text-slate-300">Danh sách này không có thẻ nào chưa giao người.</p>
          )}

          {data && data.truncated && (
            <p role="note" className="mb-3 rounded bg-sky-50 p-2 text-xs text-sky-900 dark:bg-sky-900/30 dark:text-sky-100">
              Danh sách có {data.totalUnassigned} thẻ chưa giao; lượt này chỉ chia {data.rows.length} thẻ gấp nhất. Áp dụng xong, mở lại để chia phần còn lại.
            </p>
          )}

          {data && data.rows.length > 0 && (
            <>
              <ul className="flex flex-col gap-1.5">{data.rows.map(renderRow)}</ul>

              <div className="mt-4 rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
                <p className="mb-1 font-semibold">Sau khi áp dụng</p>
                <ul className="space-y-0.5">
                  {shares.map((s) => (
                    <li key={s.person.user.id} data-testid={`plan-share-${s.person.user.id}`} className="flex flex-wrap items-center gap-x-2">
                      <span className="font-medium">{s.person.user.name}</span>
                      <span className="text-slate-600 dark:text-slate-300">
                        +{s.added} thẻ mới · đang mở {s.total}/{s.person.capacity}
                      </span>
                      {s.person.paused && <span className={WARN_BADGE}>Đang tạm nghỉ</span>}
                      {s.over && <span className={WARN_BADGE}>Vượt sức chứa</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">"Đang mở" tính mọi thẻ chưa xong của người đó, kể cả thẻ không trùng thời gian.</p>
              </div>
            </>
          )}
        </div>

        {data && data.rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {failures.length > 0
                ? `${failures.length} thẻ chưa giao được — sửa rồi bấm áp dụng lại.`
                : risky > 0
                  ? `${risky} thẻ giao cho người đang quá tải hoặc tạm nghỉ.`
                  : `Sẽ giao ${selection.length} thẻ.`}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={close} disabled={applying} className="rounded px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700">
                Đóng
              </button>
              <button
                type="button"
                onClick={() => void apply()}
                disabled={applying || selection.length === 0}
                className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {applying ? 'Đang giao…' : `Áp dụng cho ${selection.length} thẻ`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
