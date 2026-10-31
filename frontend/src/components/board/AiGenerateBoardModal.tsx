import axios from 'axios';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspaces } from '../../context/WorkspacesContext';
import { applyBoardPlan, extractDocument, fetchAiStatus, generateBoardPlan } from '../../lib/api/ai';
import { countSelected, planEdited, validatePlan } from '../../lib/aiPlan';
import { getErrorMessage } from '../../lib/errorMessage';
import type {
  AiInputKind,
  AiStatus,
  BoardPlan,
  ExtractedDocument,
  GeneratePlanResult,
  PlanMode,
} from '../../types/ai';
import type { Board } from '../../types/board';
import ConfirmDialog from '../ConfirmDialog';
import AiPlanEditor from './AiPlanEditor';

// Giao dien "Tao bang bang AI" (AI_MODULE.md buoc 8).
//   Man 1 (nhap): mo ta / tep .docx .pdf -> chu de SUA -> "Tao ke hoach"
//   Man 2 (xem truoc, BAT BUOC): sua tick/tieu de/ngay -> "Tao bang"
// KHONG BAO GIO tu dong tao bang. Modal do component CHA giu trang thai mo/dong va render nhu
// ANH EM cua popover "Tao moi" (popover tu dong khi bam ra ngoai, con modal nam ngoai vung do).

export const AI_MIN_CHARS = 20;
export const AI_MAX_CHARS = 20000; // = gioi han cua backend (MAX_INPUT_TEXT_CHARS)
const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface Props {
  onClose: () => void;
  onCreated: (board: Board) => void;
  /** Neu truyen: khoa bang vao dung khong gian nay (an o chon). */
  workspaceId?: string;
}

/** Loi tu server: uu tien thong diep cu the cua truong dau tien bi loi (400 kiem tra dau vao). */
function explain(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { errors?: Array<{ message?: string }> } | undefined;
    const first = data?.errors?.find((e) => typeof e.message === 'string' && e.message !== '')?.message;
    if (first) return first;
  }
  return getErrorMessage(err, fallback);
}

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
const label = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300';

type ConfirmAction = 'close' | 'back' | null;

export default function AiGenerateBoardModal({ onClose, onCreated, workspaceId: forcedWorkspaceId }: Props) {
  const { workspaces, currentWorkspaceId } = useWorkspaces();

  const [view, setView] = useState<'input' | 'preview'>('input');
  // Khong gian lam viec: state CUC BO khoi tao 1 lan. KHONG dong bo nguoc voi context de doi khong
  // gian o noi khac giua chung khong lam modal doi lua chon hay dong (loi #5 cua v1).
  const [workspaceChoice, setWorkspaceChoice] = useState(forcedWorkspaceId ?? currentWorkspaceId ?? '');
  // Neu luc mo modal context chua tai xong (rong) thi tam dung khong gian hien tai khi no co; tu luc
  // nguoi dung da co lua chon thi khong bao gio bi ghi de.
  const workspaceId = workspaceChoice || forcedWorkspaceId || currentWorkspaceId || '';
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'' | PlanMode>('');
  const [projectStart, setProjectStart] = useState('');
  const [projectEnd, setProjectEnd] = useState('');
  const [skipWeekend, setSkipWeekend] = useState(true);

  const [status, setStatus] = useState<AiStatus | null | undefined>(undefined);
  const [extracting, setExtracting] = useState(false);
  // Tep da doc: AI dung thang chu trong tep (khong do ra o nhap de sua - sai sot sua o man xem truoc ke hoach).
  // Chu go tay van giu nguyen ben duoi, bo tep la quay lai dung.
  const [fileNote, setFileNote] = useState<{ name: string; doc: ExtractedDocument } | null>(null);
  const sourceText = fileNote ? fileNote.doc.text : text;
  const inputKind: AiInputKind = fileNote ? fileNote.doc.inputKind : 'TEXT';
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<GeneratePlanResult | null>(null);
  const [plan, setPlan] = useState<BoardPlan | null>(null);
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false); // chan bam dup: state cap nhat bat dong bo, ref thi tuc thoi
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  useEffect(() => {
    let alive = true;
    fetchAiStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus(null));
    return () => {
      alive = false;
    };
  }, []);

  // ---------- Dong modal ----------
  const requestClose = useCallback(() => {
    if (applying) return;
    // Man xem truoc / dang phan tich: dong nham la mat ke hoach (ton 1 luot sinh) -> hoi lai
    if (view === 'preview' || generating) setConfirmAction('close');
    else onClose();
  }, [applying, view, generating, onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ConfirmDialog tu xu ly Esc cua no; neu ta cung xu ly thi hop thoai vua huy da bi mo lai
      if (e.key === 'Escape' && confirmAction === null) requestClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmAction, requestClose]);

  // ---------- Man 1: nhap ----------
  const rangeInvalid = projectStart !== '' && projectEnd !== '' && projectStart > projectEnd;
  const trimmedLength = sourceText.trim().length;
  const canGenerate =
    !generating && !extracting && trimmedLength >= AI_MIN_CHARS && workspaceId !== '' && !rangeInvalid;

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // cho phep chon lai dung tep do lan sau
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.docx') && !lower.endsWith('.pdf')) {
      setError('Chỉ hỗ trợ tệp .docx hoặc .pdf.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('Tệp quá lớn (tối đa 5MB).');
      return;
    }
    setExtracting(true);
    setError(null);
    try {
      const doc = await extractDocument(file);
      setFileNote({ name: file.name, doc });
    } catch (err) {
      setError(explain(err, 'Không đọc được tệp.'));
    } finally {
      setExtracting(false);
    }
  }


  async function generate() {
    if (!canGenerate) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await generateBoardPlan({
        workspaceId,
        text: sourceText.trim(),
        inputKind,
        ...(mode ? { mode } : {}),
        ...(projectStart ? { projectStart } : {}),
        ...(projectEnd ? { projectEnd } : {}),
        skipWeekend,
      });
      setResult(res);
      setPlan(res.plan);
      setView('preview');
    } catch (err) {
      // Giu nguyen moi thu nguoi dung da nhap
      setError(explain(err, 'Không tạo được kế hoạch. Hãy thử lại.'));
    } finally {
      setGenerating(false);
    }
  }

  // ---------- Man 2: xem truoc ----------
  const issues = plan ? validatePlan(plan) : [];
  const selectedCount = plan ? countSelected(plan) : 0;

  async function apply() {
    if (!plan || !result || applyingRef.current || issues.length > 0) return;
    applyingRef.current = true;
    setApplying(true);
    setError(null);
    try {
      const board = await applyBoardPlan(result.runId, plan);
      onCreated(board); // cha dong modal va chuyen sang bang moi
    } catch (err) {
      setError(explain(err, 'Không tạo được bảng. Hãy thử lại.'));
      applyingRef.current = false;
      setApplying(false);
    }
  }

  function backToInput() {
    setView('input');
    setResult(null);
    setPlan(null);
    setError(null);
    setConfirmAction(null);
  }

  function requestBack() {
    if (result && plan && planEdited(result.plan, plan)) setConfirmAction('back');
    else backToInput();
  }

  const locked = applying;
  const workspaceName = workspaces.find((w) => w.id === workspaceId)?.name ?? 'Không gian làm việc';

  return createPortal(
    <>
      <div
        className="tf-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-[2px] sm:p-4"
        onClick={requestClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-modal-title"
          onClick={(e) => e.stopPropagation()}
          className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-800 dark:text-slate-100"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <h2 id="ai-modal-title" className="text-sm font-semibold">
              {view === 'input' ? 'Tạo bảng bằng AI' : 'Xem trước kế hoạch'}
            </h2>
            <button
              type="button"
              onClick={requestClose}
              disabled={locked}
              aria-label="Đóng"
              className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {view === 'input' ? (
              <div className="flex flex-col gap-3">
                {status && (
                  <p
                    className={`rounded-lg px-3 py-2 text-xs ${
                      status.llmAvailable
                        ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300'
                    }`}
                  >
                    {status.llmAvailable
                      ? `AI đang bật: ${status.provider} · ${status.model}`
                      : 'Chưa bật AI: hệ thống sẽ dùng bộ luật đọc văn bản (vẫn tạo được kế hoạch, nhưng thẻ sẽ ít thông minh hơn).'}
                  </p>
                )}

                <div>
                  <label className={label} htmlFor="ai-workspace">
                    Không gian làm việc
                  </label>
                  {forcedWorkspaceId ? (
                    <p className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">
                      {workspaceName}
                    </p>
                  ) : (
                    <select
                      id="ai-workspace"
                      value={workspaceId}
                      onChange={(e) => setWorkspaceChoice(e.target.value)}
                      className={field}
                    >
                      {workspaces.length === 0 && <option value="">Đang tải...</option>}
                      {workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    {fileNote ? (
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Tệp mô tả công việc</p>
                    ) : (
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="ai-text">
                        Mô tả công việc
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={extracting || generating}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      {extracting ? 'Đang đọc tệp...' : fileNote ? 'Chọn tệp khác' : 'Tải lên .docx / .pdf'}
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      aria-label="Tệp báo cáo"
                      onChange={pickFile}
                      className="hidden"
                    />
                  </div>
                  {fileNote ? (
                    <div
                      role="group"
                      aria-label={`Tệp đã chọn: ${fileNote.name}`}
                      className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40"
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white text-[10px] font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600">
                        {fileNote.doc.inputKind === 'PDF' ? 'PDF' : 'DOCX'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100" title={fileNote.name}>
                          {fileNote.name}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {fileNote.doc.pages ? `${fileNote.doc.pages} trang · ` : ''}đọc được{' '}
                          {fileNote.doc.chars.toLocaleString('vi-VN')} ký tự
                        </p>
                        {fileNote.doc.truncated && (
                          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                            Tệp dài hơn giới hạn nên AI chỉ đọc phần đầu.
                          </p>
                        )}
                        {trimmedLength < AI_MIN_CHARS && (
                          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                            Tệp có quá ít chữ (cần ít nhất {AI_MIN_CHARS} ký tự).
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setFileNote(null)}
                        disabled={generating}
                        className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                      >
                        Bỏ tệp
                      </button>
                    </div>
                  ) : (
                    <>
                      <textarea
                        id="ai-text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        maxLength={AI_MAX_CHARS}
                        rows={10}
                        disabled={extracting}
                        placeholder={
                          'Dán hoặc gõ mô tả dự án. Ví dụ:\n- Chốt thông điệp chiến dịch, hạn 20/10\n- Thiết kế bộ nhận diện, hạn 25/10\n- Chạy quảng cáo từ 1/11 đến 15/11'
                        }
                        className={`${field} resize-y leading-relaxed`}
                      />
                      <div className="mt-1 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>{trimmedLength < AI_MIN_CHARS ? `Cần ít nhất ${AI_MIN_CHARS} ký tự` : ''}</span>
                        <span aria-label="Số ký tự">
                          {text.length}/{AI_MAX_CHARS}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                <details className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                  <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">
                    Tuỳ chọn
                  </summary>
                  <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className={label} htmlFor="ai-mode">
                        Cách đọc văn bản
                      </label>
                      <select
                        id="ai-mode"
                        value={mode}
                        onChange={(e) => setMode(e.target.value as '' | PlanMode)}
                        className={field}
                      >
                        <option value="">Tự nhận diện (khuyến nghị)</option>
                        <option value="STRUCTURED">Có cấu trúc (tiêu đề, gạch đầu dòng)</option>
                        <option value="FREEFORM">Văn xuôi (AI tự rút ra việc cần làm)</option>
                      </select>
                    </div>
                    <div>
                      <label className={label} htmlFor="ai-start">
                        Ngày bắt đầu dự án
                      </label>
                      <input
                        id="ai-start"
                        type="date"
                        value={projectStart}
                        onChange={(e) => setProjectStart(e.target.value)}
                        className={field}
                      />
                    </div>
                    <div>
                      <label className={label} htmlFor="ai-end">
                        Ngày kết thúc dự án
                      </label>
                      <input
                        id="ai-end"
                        type="date"
                        value={projectEnd}
                        onChange={(e) => setProjectEnd(e.target.value)}
                        className={field}
                      />
                    </div>
                    {rangeInvalid && (
                      <p role="alert" className="text-xs font-medium text-red-600 sm:col-span-2 dark:text-red-400">
                        Ngày bắt đầu phải trước ngày kết thúc.
                      </p>
                    )}
                    <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-2 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={skipWeekend}
                        onChange={(e) => setSkipWeekend(e.target.checked)}
                        className="h-4 w-4 accent-primary"
                      />
                      Bỏ thứ Bảy, Chủ nhật khi xếp lịch
                    </label>
                  </div>
                </details>
              </div>
            ) : (
              plan &&
              result && (
                <AiPlanEditor
                  plan={plan}
                  onChange={setPlan}
                  issues={issues}
                  llmUsed={result.llmUsed}
                  modeAuto={result.modeAuto}
                  disabled={locked}
                />
              )
            )}
          </div>

          <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
            {error && (
              <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            {view === 'preview' && issues.length > 0 && (
              <p className="mb-2 text-xs text-red-600 dark:text-red-400">
                Cần sửa {issues.length} chỗ trước khi tạo bảng: {issues[0]!.message}
              </p>
            )}
            {generating && (
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400" role="status">
                Đang phân tích mô tả… có thể mất tới 30 giây, xin đừng đóng cửa sổ.
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              {view === 'input' ? (
                <>
                  <button
                    type="button"
                    onClick={requestClose}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Huỷ
                  </button>
                  <button
                    type="button"
                    onClick={() => void generate()}
                    disabled={!canGenerate}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {generating ? 'Đang phân tích...' : 'Tạo kế hoạch'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={requestBack}
                    disabled={locked}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    ← Quay lại chỉnh mô tả
                  </button>
                  <button
                    type="button"
                    onClick={() => void apply()}
                    disabled={locked || issues.length > 0}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {applying ? 'Đang tạo bảng...' : `Tạo bảng (${selectedCount} thẻ)`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction === 'back' ? 'Quay lại và bỏ các chỉnh sửa?' : 'Bỏ kế hoạch này?'}
        message={
          confirmAction === 'back'
            ? 'Các chỉnh sửa của bạn trên kế hoạch sẽ mất; bạn cần tạo kế hoạch mới.'
            : generating
              ? 'Hệ thống đang phân tích mô tả. Đóng lúc này sẽ bỏ kết quả.'
              : 'Kế hoạch đã tạo (và các chỉnh sửa của bạn) sẽ mất.'
        }
        confirmLabel={confirmAction === 'back' ? 'Quay lại' : 'Bỏ kế hoạch'}
        cancelLabel="Tiếp tục chỉnh"
        danger
        onConfirm={() => (confirmAction === 'back' ? backToInput() : onClose())}
        onCancel={() => setConfirmAction(null)}
      />
    </>,
    document.body
  );
}
