import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchAssignProfile,
  fetchAssignWeights,
  resetAssignWeights,
  saveAssignProfile,
  saveAssignWeights,
} from '../lib/api/assign';
import { endOfLocalDayIso, formatViDate, isPausedNow, toLocalDateInput } from '../lib/assignDates';
import { COMPONENT_HINT, COMPONENT_LABEL, COMPONENT_SHORT } from '../lib/assignLabels';
import {
  WEIGHT_KEYS,
  WEIGHT_MAX_PCT,
  WEIGHT_MIN_PCT,
  fromPct,
  historyPct,
  rebalance,
  samePct,
  toPct,
  type WeightsPct,
} from '../lib/assignWeights';
import { getErrorMessage } from '../lib/errorMessage';
import type { AssignProfile, AssignWeightsView } from '../types/assign';
import ConfirmDialog from './ConfirmDialog';

// Mục "Gợi ý phân công" của trang cài đặt không gian làm việc (ASSIGN_MODULE.md §6, §8, §17): bốn thanh trượt trọng số của nhóm,
// trạng thái tự học, lịch sử thay đổi, và cấu hình làm việc của CHÍNH người xem (số thẻ chồng lấn tối đa, tạm nghỉ).

interface Props {
  workspaceId: string;
  /** OWNER / ADMIN của không gian: chỉnh và đặt lại được trọng số. */
  canManage: boolean;
}

const MAX_PARALLEL_MIN = 1;
const MAX_PARALLEL_MAX = 30;

// Mốc lịch sử trước khi có Hồ sơ chỉ có ba khoá -> chỉ in các khoá có mặt
const pctText = (p: Partial<WeightsPct>) =>
  WEIGHT_KEYS.filter((k) => p[k] !== undefined)
    .map((k) => `${COMPONENT_SHORT[k]} ${p[k]}%`)
    .join(' · ');
const pctSlash = (p: WeightsPct) => WEIGHT_KEYS.map((k) => `${p[k]}%`).join(' / ');

function fmtDateTime(iso: string): string {
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) ? t.toLocaleString('vi-VN') : '';
}

export default function AssignWeightsPanel({ workspaceId, canManage }: Props) {
  const [view, setView] = useState<AssignWeightsView | null>(null);
  const [profile, setProfile] = useState<AssignProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<WeightsPct | null>(null);
  const [capDraft, setCapDraft] = useState('');
  const [pauseDraft, setPauseDraft] = useState('');
  const [busy, setBusy] = useState<'weights' | 'reset' | 'profile' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const applyView = useCallback((v: AssignWeightsView) => {
    setView(v);
    setDraft(toPct(v.weights));
  }, []);
  const applyProfile = useCallback((p: AssignProfile) => {
    setProfile(p);
    setCapDraft(String(p.maxParallelCards));
    setPauseDraft(toLocalDateInput(p.pausedUntil));
  }, []);

  // Đổi không gian / bấm Làm mới khi yêu cầu cũ chưa về: chỉ nhận kết quả của yêu cầu MỚI NHẤT
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    Promise.all([fetchAssignWeights(workspaceId), fetchAssignProfile(workspaceId)])
      .then(([v, p]) => {
        if (seq !== loadSeq.current) return;
        setLoadError(null);
        applyView(v);
        applyProfile(p);
      })
      .catch((err) => {
        if (seq === loadSeq.current) setLoadError(getErrorMessage(err, 'Không tải được cấu hình gợi ý phân công.'));
      });
  }, [workspaceId, applyView, applyProfile]);

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Gợi ý phân công</h2>
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {loadError}{' '}
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              load();
            }}
            className="font-medium underline"
          >
            Thử lại
          </button>
        </p>
      </section>
    );
  }
  // Dữ liệu của một không gian KHÁC (đổi không gian mà chưa tải xong) coi như chưa có
  if (!view || !draft || !profile || view.workspaceId !== workspaceId) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Gợi ý phân công</h2>
        <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
          Đang tải…
        </p>
      </section>
    );
  }

  const saved = toPct(view.weights);
  const dirty = !samePct(draft, saved);
  const remaining = Math.max(0, view.learning.minFeedback - view.feedbackCount);
  const rate = view.feedback.decided > 0 ? Math.round((view.feedback.accepted / view.feedback.decided) * 100) : null;
  const canReset = view.custom || view.feedbackCount > 0;

  const capNum = Number(capDraft);
  const capValid = capDraft.trim() !== '' && Number.isInteger(capNum) && capNum >= MAX_PARALLEL_MIN && capNum <= MAX_PARALLEL_MAX;
  const pauseIso = pauseDraft === '' ? null : endOfLocalDayIso(pauseDraft);
  const pauseValid = pauseDraft === '' || pauseIso !== null;
  const profileDirty = capValid && (capNum !== profile.maxParallelCards || pauseDraft !== toLocalDateInput(profile.pausedUntil));
  const pausedNow = isPausedNow(profile.pausedUntil);

  async function saveWeights() {
    if (!draft || !dirty || busy) return;
    setBusy('weights');
    setError(null);
    setNotice(null);
    try {
      applyView(await saveAssignWeights(workspaceId, fromPct(draft)));
      setNotice('Đã lưu trọng số.');
    } catch (err) {
      setError(getErrorMessage(err, 'Không lưu được trọng số.'));
    } finally {
      setBusy(null);
    }
  }

  async function doReset() {
    setBusy('reset');
    setError(null);
    setNotice(null);
    try {
      applyView(await resetAssignWeights(workspaceId));
      setNotice(`Đã đặt lại ${pctSlash(toPct(view!.defaults))} và bắt đầu đếm phản hồi từ đầu.`);
    } catch (err) {
      setError(getErrorMessage(err, 'Không đặt lại được trọng số.'));
    } finally {
      setBusy(null);
      setConfirmReset(false);
    }
  }

  async function saveProfile() {
    if (!profileDirty || !pauseValid || busy) return;
    setBusy('profile');
    setError(null);
    setNotice(null);
    try {
      applyProfile(await saveAssignProfile(workspaceId, { maxParallelCards: capNum, pausedUntil: pauseIso }));
      setNotice('Đã lưu cấu hình làm việc của bạn.');
    } catch (err) {
      setError(getErrorMessage(err, 'Không lưu được cấu hình làm việc.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Gợi ý phân công</h2>
        <button type="button" onClick={load} className="text-xs font-medium text-primary-ink hover:underline">
          Làm mới
        </button>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Khi mở ô Thành viên của một thẻ, hệ thống xếp hạng ai hợp với thẻ dựa trên các thẻ mà mỗi người đã hoàn thành trong không
        gian này và hồ sơ kỹ năng họ tự khai. Điểm là tổng có trọng số của bốn thành phần dưới đây; không bao giờ tự động giao việc.
      </p>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          {notice}
        </p>
      )}

      {/* Trọng số */}
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Trọng số của nhóm</p>
        {WEIGHT_KEYS.map((k) => (
          <div key={k} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-3">
              <label htmlFor={`assign-w-${k}`} className="w-28 shrink-0 text-sm text-slate-700 dark:text-slate-200">
                {COMPONENT_LABEL[k]}
              </label>
              <input
                id={`assign-w-${k}`}
                type="range"
                min={WEIGHT_MIN_PCT}
                max={WEIGHT_MAX_PCT}
                step={1}
                value={draft[k]}
                disabled={!canManage || busy !== null}
                onChange={(e) => setDraft(rebalance(draft, k, Number(e.target.value)))}
                aria-label={COMPONENT_LABEL[k]}
                aria-valuetext={`${draft[k]}%`}
                className="min-w-0 flex-1 accent-primary disabled:opacity-60"
              />
              <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{draft[k]}%</span>
            </div>
            <p className="text-xs text-slate-500 sm:pl-[7.75rem] dark:text-slate-400">{COMPONENT_HINT[k]}</p>
          </div>
        ))}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Mỗi thành phần từ {WEIGHT_MIN_PCT}% đến {WEIGHT_MAX_PCT}%, tổng luôn 100% (kéo một thanh thì các thanh kia tự chia lại theo tỉ lệ).
          Điểm chỉ so sánh giữa những người trong danh sách của <em>đúng thẻ đó</em>.
        </p>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void saveWeights()}
              disabled={!dirty || busy !== null}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            >
              Lưu trọng số
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => setDraft(saved)}
                disabled={busy !== null}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Hoàn tác
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              disabled={!canReset || busy !== null}
              className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Đặt lại mặc định
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">Chỉ chủ hoặc quản trị viên của không gian mới chỉnh được trọng số.</p>
        )}
      </div>

      {/* Tự học + số liệu phản hồi */}
      <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
        <p>
          Đã ghi nhận <strong>{view.feedbackCount}</strong> lượt phản hồi (mỗi lần bạn giao thẻ sau khi xem gợi ý).
          {rate !== null && (
            <>
              {' '}
              Giao đúng người xếp đầu: <strong>{view.feedback.accepted}/{view.feedback.decided}</strong> ({rate}%).
            </>
          )}
        </p>
        <p className="mt-1">
          {view.learning.active
            ? `Đang tự học: mỗi lần bạn giao cho người khác người xếp đầu, trọng số nhích về phía thành phần người đó hơn (bước ${Math.round(view.learning.eta * 100)}%).`
            : `Bắt đầu tự học từ phản hồi thứ ${view.learning.minFeedback} (còn ${remaining} lượt); trước đó chỉ ghi nhận.`}
        </p>
      </div>

      {/* Lịch sử */}
      {view.history.length > 0 && (
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">Lịch sử thay đổi trọng số</p>
          <ul className="max-h-48 space-y-1 overflow-auto text-xs text-slate-600 dark:text-slate-300">
            {view.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-x-2">
                <span className="text-slate-500 dark:text-slate-400">{fmtDateTime(h.at)}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    h.source === 'LEARNED'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  {h.source === 'LEARNED' ? 'Tự học' : 'Chỉnh tay'}
                </span>
                <span className="tabular-nums">{pctText(historyPct(h.weights))}</span>
                <span className="text-slate-400">· phản hồi #{h.feedbackCount}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cấu hình của tôi */}
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Cấu hình làm việc của tôi</p>
        {pausedNow && (
          <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            Bạn đang được đánh dấu tạm nghỉ đến hết ngày {formatViDate(profile.pausedUntil!)}: gợi ý sẽ không xếp bạn vào việc mới.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-0.5">
            <label htmlFor="assign-cap" className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Số thẻ chồng lấn tối đa
            </label>
            <input
              id="assign-cap"
              type="number"
              min={MAX_PARALLEL_MIN}
              max={MAX_PARALLEL_MAX}
              step={1}
              value={capDraft}
              onChange={(e) => setCapDraft(e.target.value)}
              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label htmlFor="assign-pause" className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Tạm nghỉ đến hết ngày
            </label>
            <div className="flex items-center gap-2">
              <input
                id="assign-pause"
                type="date"
                value={pauseDraft}
                onChange={(e) => setPauseDraft(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600"
              />
              {pauseDraft !== '' && (
                <button type="button" onClick={() => setPauseDraft('')} className="text-xs font-medium text-primary-ink hover:underline">
                  Bỏ tạm nghỉ
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void saveProfile()}
            disabled={!profileDirty || !pauseValid || busy !== null}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            Lưu cấu hình
          </button>
        </div>
        {!capValid && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-300">
            Số thẻ chồng lấn tối đa phải là số nguyên từ {MAX_PARALLEL_MIN} đến {MAX_PARALLEL_MAX}.
          </p>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Nếu số thẻ đang mở chồng lấn với thẻ mới đạt mức này, gợi ý gắn cờ "Quá tải" cho bạn (mặc định {profile.defaultMaxParallelCards}).
          Chỉ bạn sửa được cấu hình của chính mình.
        </p>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Đặt lại trọng số mặc định?"
        message={`Trọng số về ${pctSlash(toPct(view.defaults))} và số lượt phản hồi về 0, nên nhóm phải gom đủ ${view.learning.minFeedback} phản hồi mới tự học lại. Lịch sử thay đổi vẫn được giữ.`}
        confirmLabel="Đặt lại"
        danger
        busy={busy === 'reset'}
        onConfirm={() => void doReset()}
        onCancel={() => setConfirmReset(false)}
      />
    </section>
  );
}
