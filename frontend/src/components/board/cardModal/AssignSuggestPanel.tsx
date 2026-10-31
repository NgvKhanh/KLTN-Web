import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAssignSuggestions, recordAssignOutcome, userCvUrl } from '../../../lib/api/assign';
import { formatViDate } from '../../../lib/assignDates';
import {
  COMPONENT_HINT,
  COMPONENT_LABEL,
  COMPONENT_SHORT,
  CONFIDENCE_LABEL,
  DECLARED_KIND_LABEL,
  OUTCOME_LABEL,
  flagLabel,
  riskWarning,
} from '../../../lib/assignLabels';
import { WEIGHT_KEYS, toPct } from '../../../lib/assignWeights';
import { getErrorMessage } from '../../../lib/errorMessage';
import { logError } from '../../../lib/logError';
import type { AssignSuggestion, AssignSuggestionResult } from '../../../types/assign';
import type { BoardMember } from '../../../types/board';
import Avatar from '../../Avatar';

// Ô "Thành viên" của thẻ có GỢI Ý PHÂN CÔNG (ASSIGN_MODULE.md §10, §17): xếp hạng người có thể nhận thẻ theo lịch sử của
// chính họ và hồ sơ tự khai, kèm bốn giá trị THÔ, cảnh báo và bằng chứng (thẻ cũ + mục hồ sơ khớp). Giao tay vẫn luôn dùng
// được: gợi ý lỗi / bị giới hạn tốc độ thì rơi về danh sách thường.

interface Props {
  cardId: string;
  boardMembers: BoardMember[];
  cardMemberIds: ReadonlySet<string>;
  /** Thêm người vào thẻ; trả true nếu thành công. */
  onAdd: (userId: string) => Promise<boolean>;
  onRemove: (userId: string) => Promise<boolean>;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: AssignSuggestionResult }
  | { status: 'error'; message: string };

// React.StrictMode (dev) chạy effect hai lần liền nhau; server ghi MỘT dòng nhật ký mỗi lượt gợi ý và giới hạn tốc độ,
// nên dùng chung yêu cầu đang bay của cùng một thẻ thay vì gọi hai lần.
const inflight = new Map<string, Promise<AssignSuggestionResult>>();
function loadOnce(cardId: string): Promise<AssignSuggestionResult> {
  let p = inflight.get(cardId);
  if (!p) {
    p = fetchAssignSuggestions(cardId).finally(() => inflight.delete(cardId));
    inflight.set(cardId, p);
  }
  return p;
}

const CHECK = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M5 13l4 4L19 7" />
  </svg>
);

const pct = (v: number) => `${Math.round(v * 100)}%`;
const NO_CANDIDATES: AssignSuggestion[] = [];

export default function AssignSuggestPanel({ cardId, boardMembers, cardMemberIds, onAdd, onRemove }: Props) {
  const [loaded, setLoaded] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Mỗi lượt gợi ý chỉ ghi NGƯỜI ĐƯỢC CHỌN đầu tiên (những người thêm sau không phải là "lựa chọn" sau khi xem gợi ý)
  const decidedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    loadOnce(cardId)
      .then((data) => {
        if (!alive) return;
        decidedRef.current = false;
        setExpanded(null);
        setConfirmId(null);
        setLoaded({ status: 'ready', data });
      })
      .catch((err) => {
        if (alive) setLoaded({ status: 'error', message: getErrorMessage(err, 'Chưa lấy được gợi ý lúc này.') });
      });
    return () => {
      alive = false;
    };
  }, [cardId, reloadKey]);

  // Kết quả của một thẻ KHÁC (đổi thẻ mà chưa kịp tải xong) coi như đang tải: không hiện gợi ý của thẻ cũ
  const state: LoadState = loaded.status === 'ready' && loaded.data.card.id !== cardId ? { status: 'loading' } : loaded;

  const candidates = state.status === 'ready' ? state.data.candidates : NO_CANDIDATES;
  const suggestionOf = useMemo(() => new Map(candidates.map((c) => [c.user.id, c])), [candidates]);
  // Thành viên bảng KHÔNG nằm trong danh sách gợi ý (vd VIEWER): vẫn liệt kê như cũ, không có điểm
  const plainMembers = boardMembers.filter((m) => !suggestionOf.has(m.userId));

  function recordOutcomeOnce(userId: string) {
    if (state.status !== 'ready') return;
    const runId = state.data.runId;
    if (!runId || decidedRef.current) return;
    decidedRef.current = true;
    recordAssignOutcome(runId, userId).catch(logError('AssignSuggestPanel: ghi lựa chọn'));
  }

  async function add(userId: string) {
    setBusyId(userId);
    let ok = false;
    try {
      ok = await onAdd(userId);
    } finally {
      setBusyId(null);
    }
    if (ok) recordOutcomeOnce(userId);
  }

  async function toggle(userId: string, name: string) {
    if (busyId) return;
    if (cardMemberIds.has(userId)) {
      setBusyId(userId);
      try {
        await onRemove(userId);
      } finally {
        setBusyId(null);
      }
      return;
    }
    // Người đang quá tải / tạm nghỉ: hỏi lại MỘT lần trước khi giao (các cờ khác chỉ hiện huy hiệu)
    const s = suggestionOf.get(userId);
    if (s && confirmId !== userId && riskWarning(name, s.flags, s)) {
      setConfirmId(userId);
      return;
    }
    setConfirmId(null);
    await add(userId);
  }

  function renderSuggestion(s: AssignSuggestion) {
    const assigned = cardMemberIds.has(s.user.id);
    const open = expanded === s.user.id;
    const warning = confirmId === s.user.id ? riskWarning(s.user.name, s.flags, s) : null;
    return (
      <li key={s.user.id} data-testid={`assign-row-${s.user.id}`} className="rounded">
        <div className="flex items-start gap-1 rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700">
          <button
            type="button"
            disabled={busyId !== null}
            aria-label={assigned ? `Bỏ ${s.user.name} khỏi thẻ` : `Giao thẻ cho ${s.user.name}`}
            onClick={() => void toggle(s.user.id, s.user.name)}
            className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:opacity-60"
          >
            <Avatar id={s.user.id} name={s.user.name} avatarUrl={s.user.avatarUrl} />
            <span className="block min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span
                  title="Thứ hạng phù hợp với thẻ này"
                  className="grid h-4 min-w-4 place-items-center rounded bg-slate-200 px-1 text-[10px] font-semibold text-slate-700 dark:bg-slate-600 dark:text-slate-100"
                >
                  {s.rank}
                </span>
                <span className="truncate text-sm font-medium">{s.user.name}</span>
                {assigned && (
                  <span className="ml-auto flex items-center gap-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {CHECK} Đã trong thẻ
                  </span>
                )}
              </span>
              {s.score !== null ? (
                <span
                  className="mt-1 flex items-center gap-2"
                  title="Điểm tương đối: chỉ so sánh giữa những người trong danh sách này cho đúng thẻ này"
                >
                  <span className="h-1.5 flex-1 overflow-hidden rounded bg-slate-200 dark:bg-slate-600">
                    <span className="block h-full rounded bg-primary" style={{ width: `${Math.max(0, Math.min(100, s.score))}%` }} />
                  </span>
                  <span className="w-16 shrink-0 text-right text-[11px] text-slate-600 dark:text-slate-300">Phù hợp {Math.round(s.score)}</span>
                </span>
              ) : (
                <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">Chưa đủ dữ liệu để chấm</span>
              )}
              <span className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                {WEIGHT_KEYS.map((k) => {
                  const v = s.components[k].value;
                  return (
                    <span key={k} title={`${COMPONENT_LABEL[k]}: ${COMPONENT_HINT[k]}`}>
                      {COMPONENT_SHORT[k]} {v === null ? '—' : pct(v)}
                    </span>
                  );
                })}
              </span>
              <span className="mt-1 flex flex-wrap gap-1">
                {s.flags.map((f) => (
                  <span
                    key={f}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      f === 'OVERLOADED' || f === 'PAUSED'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {flagLabel(f, s)}
                  </span>
                ))}
                <span
                  title="Mức đủ của dữ liệu lịch sử dùng để chấm người này"
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    s.confidenceLevel === 'GOOD'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                      : s.confidenceLevel === 'FAIR'
                        ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  {CONFIDENCE_LABEL[s.confidenceLevel]}
                </span>
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-expanded={open}
            aria-label={`Vì sao gợi ý ${s.user.name}`}
            onClick={() => setExpanded(open ? null : s.user.id)}
            className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary-ink hover:bg-slate-200 dark:hover:bg-slate-600"
          >
            Vì sao? {open ? '▴' : '▾'}
          </button>
        </div>
        {open && (
          <div className="mb-1 ml-9 border-l-2 border-slate-200 pl-2 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300">
            {s.evidence.length === 0 ? (
              <p>
                {s.flags.includes('NO_HISTORY')
                  ? 'Người này chưa hoàn thành thẻ nào trong không gian làm việc này.'
                  : 'Chưa có thẻ cũ nào đủ giống thẻ này.'}
              </p>
            ) : (
              <>
                <p className="mb-1">Dựa trên những thẻ đã hoàn thành giống thẻ này nhất:</p>
                <ul className="space-y-1">
                  {s.evidence.map((e) => (
                    <li key={e.cardId}>
                      {e.title === null ? <i>Thẻ ở bảng riêng tư</i> : <span className="font-medium">{e.title}</span>}
                      <span className="text-slate-500 dark:text-slate-400">
                        {' '}
                        — {pct(e.sim)} giống · {OUTCOME_LABEL[e.outcome]} · {formatViDate(e.completedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {renderDeclared(s)}
          </div>
        )}
        {warning && (
          <div role="alert" className="mb-1 ml-9 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
            <p>{warning} Vẫn giao thẻ này?</p>
            <div className="mt-1.5 flex gap-2">
              <button type="button" onClick={() => void add(s.user.id).then(() => setConfirmId(null))} className="rounded bg-amber-600 px-2 py-1 font-medium text-white hover:bg-amber-700">
                Vẫn giao
              </button>
              <button type="button" onClick={() => setConfirmId(null)} className="rounded px-2 py-1 font-medium hover:bg-amber-100 dark:hover:bg-amber-800/50">
                Huỷ
              </button>
            </div>
          </div>
        )}
      </li>
    );
  }

  // Phần "Hồ sơ tự khai" của mục "Vì sao?": mục khớp nhất (CV chỉ nói "một đoạn trong CV", không bao giờ có chữ) + nút tải CV
  // cho người có quyền (máy chủ quyết định `cvAvailable`).
  function renderDeclared(s: AssignSuggestion) {
    const cv = s.cvAvailable ? (
      <a href={userCvUrl(s.user.id)} download className="font-medium text-primary-ink hover:underline">
        Tải CV
      </a>
    ) : null;
    if (s.declaredEvidence.length > 0) {
      return (
        <div className="mt-1.5">
          <p className="mb-1">
            Khớp hồ sơ tự khai <span className="text-slate-500 dark:text-slate-400">(chưa kiểm chứng)</span>:
          </p>
          <ul className="space-y-1">
            {s.declaredEvidence.map((e) => (
              <li key={`${e.kind}-${e.itemId}`}>
                <span className="text-slate-500 dark:text-slate-400">{DECLARED_KIND_LABEL[e.kind]}: </span>
                {e.title === null ? <i>một đoạn trong CV</i> : <span className="font-medium">{e.title}</span>}
                <span className="text-slate-500 dark:text-slate-400"> — {pct(e.sim)} giống</span>
              </li>
            ))}
          </ul>
          {cv && <p className="mt-1">{cv}</p>}
        </div>
      );
    }
    return (
      <p className="mt-1.5">
        {s.flags.includes('NO_PROFILE') ? 'Chưa khai hồ sơ kỹ năng.' : 'Hồ sơ tự khai không có mục nào đủ giống thẻ này.'}
        {cv && <> {cv}</>}
      </p>
    );
  }

  function renderPlain(m: BoardMember) {
    const assigned = cardMemberIds.has(m.userId);
    return (
      <li key={m.userId}>
        <button
          type="button"
          disabled={busyId !== null}
          onClick={() => void toggle(m.userId, m.user.name)}
          className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-slate-100 disabled:opacity-60 dark:hover:bg-slate-700"
        >
          <Avatar id={m.userId} name={m.user.name} avatarUrl={m.user.avatarUrl} />
          <span className="flex-1 truncate text-sm">{m.user.name}</span>
          {assigned && CHECK}
        </button>
      </li>
    );
  }

  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">Thành viên</p>

      {state.status === 'loading' && (
        <div role="status" aria-live="polite" className="space-y-1.5 px-1 py-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">Đang tính gợi ý dựa trên lịch sử làm việc…</p>
          <div className="h-8 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
          <div className="h-8 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
        </div>
      )}

      {state.status === 'error' && (
        <div className="mb-1 rounded bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-700/50 dark:text-slate-300">
          <p>{state.message} Bạn vẫn giao thẻ bằng tay được.</p>
          <button
            type="button"
            onClick={() => {
              setLoaded({ status: 'loading' });
              setReloadKey((k) => k + 1);
            }}
            className="mt-1 font-medium text-primary-ink hover:underline"
          >
            Thử lại
          </button>
        </div>
      )}

      {state.status === 'ready' && candidates.length > 0 && (
        <p className="mb-1 px-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          Xếp theo độ phù hợp với thẻ này, dựa trên các thẻ cũ trong không gian làm việc và hồ sơ tự khai. KN = kinh nghiệm · TC =
          độ tin cậy · KD = khả dụng · HS = hồ sơ tự khai.
        </p>
      )}

      {state.status !== 'loading' && (
        <ul className="flex flex-col gap-0.5">
          {candidates.map(renderSuggestion)}
          {plainMembers.map(renderPlain)}
        </ul>
      )}

      {state.status === 'ready' && candidates.length > 0 && (
        <div className="mt-2 border-t border-slate-200 px-1 pt-1.5 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {(() => {
            const w = toPct(state.data.weights);
            return (
              <p>
                Trọng số nhóm: Kinh nghiệm {w.experience}% · Tin cậy {w.reliability}% · Khả dụng {w.availability}% · Hồ sơ {w.declared}%
                {state.data.weights.custom ? ' (đã tuỳ chỉnh)' : ''}.{' '}
                <Link to={`/workspaces/${state.data.card.workspaceId}`} className="font-medium text-primary-ink hover:underline">
                  Xem / chỉnh
                </Link>
              </p>
            );
          })()}
        </div>
      )}
    </div>
  );
}
