import axios from 'axios';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAssistant } from '../../context/AssistantContext';
import { MAX_QUESTION_CHARS, PRIVACY_NOTE, QUICK_QUESTIONS } from '../../lib/chatText';
import { discardChatUpload, uploadChatFile } from '../../lib/api/chat';
import { scopeChipText, scopeChipTitle } from '../../lib/chatScope';
import type { ChatStagedFile, ChatStatus } from '../../types/chat';
import AnswerView from './AnswerView';

/**
 * Panel tro ly ben phai (§13): portal ra body, nam DUOI Header (top-14). Lop z-[35]: tren noi dung
 * trang + lop phu z-30, DUOI menu / popover z-40 (menu tai khoan, "Tạo mới" cua Header - cung z-40 thi
 * panel ve sau se che mat, loi tim thay khi thu tren trinh duyet) va DUOI modal z-50 (CardModal: bam
 * lien ket the thi the mo de len panel). Bam ra ngoai KHONG dong
 * (nguoi dung vua doc tra loi vua thao tac tren bang); Esc chi dong khi con tro dang o trong panel.
 * Dong panel thi khong render gi: khong dung context bang / khong gian, khong goi API.
 */
export default function AssistantPanel() {
  const { open } = useAssistant();
  return open ? createPortal(<PanelBody />, document.body) : null;
}

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip';

function uploadErrorText(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: unknown } | undefined)?.message;
    if (err.response?.status === 400 && typeof message === 'string' && message !== '') return message;
    if (err.response?.status === 429) return 'Bạn tải tệp hơi nhiều trong thời gian ngắn. Hãy thử lại sau ít phút.';
    if (!err.response) return 'Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.';
  }
  return 'Tải tệp lên chưa được. Hãy thử lại.';
}

const ACTION_EXAMPLES = ['Chuyển task Login sang Đang làm', 'Giao thẻ Báo cáo tuần cho Lan', 'Đặt hạn thẻ Thiết kế là thứ sáu', 'Thêm bình luận vào thẻ Login: đã review xong', 'Tạo thẻ Deploy rồi thêm checklist gồm build, test', 'Xóa danh sách 5', 'Chuyển hết thẻ cột Cần làm sang cột Đang làm', 'Đính kèm file này vào thẻ Login (bấm nút kẹp giấy)', 'Đổi quyền Nguyễn Lan thành chỉ xem', 'Tạo nhãn Khẩn cấp màu đỏ'];

function Intro({ busy, status, onAsk }: { busy: boolean; status: ChatStatus | null; onAsk: (q: string) => void }) {
  return (
    <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
      <p>
        Trợ lý tra cứu công việc, người phụ trách, khối lượng của từng thành viên, lịch sử thay đổi, mô tả, bình luận, checklist và
        tệp đính kèm trên các bảng bạn được phép xem. Bạn có thể hỏi nhiều nội dung trong một câu và nêu tên bảng hoặc không gian cần xem.
        {status?.actions !== true && ' Trợ lý hiện chỉ đọc dữ liệu.'}
      </p>
      {status?.actions === true && (
        <div className="space-y-1">
          <p>
            Trợ lý cũng làm giúp các thao tác trên một bảng. Với thẻ: tạo, đổi tên, đặt hạn và ngày bắt đầu, chuyển cột, đổi trạng thái, giao hoặc bỏ người, gắn hoặc gỡ nhãn, sửa mô tả,
            bình luận (viết, sửa, trả lời, xóa), checklist (thêm, tick, sửa, giao việc, xóa), đính kèm hoặc gỡ tệp, trường tùy chỉnh, nhắc hạn, theo dõi, thẻ mẫu; lưu trữ, khôi phục, sao chép, xóa.
            Với cột: đổi tên, đổi vị trí, sắp xếp, sao chép, lưu trữ, xóa, chuyển hết thẻ sang cột khác. Với bảng (chủ bảng hoặc quản trị viên): đổi tên, chế độ hiển thị, gắn sao, link mời, nhãn, luật tự động hóa,
            thành viên và quyền, trường tùy chỉnh, lưu trữ hoặc xóa bảng. Việc nhỏ và rõ ràng thì làm ngay; nội dung văn bản, xóa, thao tác cả cột, quản trị bảng hay lệnh còn mơ hồ thì hiện bản xem trước để bạn bấm Áp dụng.
          </p>
          <ul className="list-disc pl-4 text-xs text-slate-500 dark:text-slate-400">{ACTION_EXAMPLES.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Thử hỏi:</p>
      <div className="flex flex-col items-start gap-1.5">
        {QUICK_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => onAsk(q)}
            className="rounded-full border border-slate-300 px-3 py-1 text-left text-xs text-slate-700 transition hover:border-primary hover:text-primary-ink disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function PanelBody() {
  const { turns, busy, scope, status, notice, conversations, activeConversationId, historyLoading, historyError, historyHasMore, olderHasMore,
    refreshHistory, selectConversation, loadOlder, closePanel, ask, choose, loadMore, confirmAction, cancelAction, newConversation } = useAssistant();
  const [draft, setDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [staged, setStaged] = useState<ChatStagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const olderScroll = useRef<{ height: number; top: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Luot moi / tra loi moi -> cuon xuong cuoi
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || historyLoading || historyOpen) return;
    if (olderScroll.current) {
      el.scrollTop = olderScroll.current.top + el.scrollHeight - olderScroll.current.height;
      olderScroll.current = null;
    } else el.scrollTop = el.scrollHeight;
  }, [turns, historyLoading, historyOpen]);

  useEffect(() => { if (historyOpen && scrollRef.current) scrollRef.current.scrollTop = 0; }, [historyOpen]);

  function send() {
    const q = draft.trim();
    if (q === '' || busy || uploading) return;
    setDraft('');
    setHistoryOpen(false);
    const files = staged;
    setStaged([]);
    setUploadError(null);
    void ask(q, files);
  }

  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (staged.length >= MAX_FILES) { setUploadError(`Mỗi lần gắn tối đa ${MAX_FILES} tệp.`); return; }
    if (file.size > MAX_FILE_BYTES) { setUploadError('Tệp quá lớn (tối đa 10MB).'); return; }
    setUploading(true);
    setUploadError(null);
    try {
      const uploaded = await uploadChatFile(file);
      setStaged((prev) => [...prev, uploaded]);
    } catch (err) {
      setUploadError(uploadErrorText(err));
    } finally {
      setUploading(false);
    }
  }

  function removeStaged(id: string) {
    setStaged((prev) => prev.filter((f) => f.id !== id));
    void discardChatUpload(id).catch(() => undefined);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send();
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter gui, Shift+Enter xuong dong; dang go bo go tieng Viet (IME) thi khong gui
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  function onPanelKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape') return;
    // Mot hop thoai modal khac dang mo de len panel -> Esc la cua lop tren cung do, khong dong panel
    const panel = e.currentTarget;
    const modalAbove = Array.from(document.querySelectorAll('[aria-modal="true"]')).some((el) => !panel.contains(el));
    if (modalAbove) return;
    e.stopPropagation();
    closePanel();
  }

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Trợ lý công việc"
      onKeyDown={onPanelKeyDown}
      className="fixed bottom-0 right-0 top-14 z-[35] flex w-full flex-col border-l border-slate-200 bg-white shadow-2xl sm:w-[420px] dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Trợ lý công việc</h2>
        <span
          title={scopeChipTitle(scope)}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {scopeChipText(scope)}
        </span>
        {status && !status.llmAvailable && (
          <span
            title="Chưa cấu hình AI: trợ lý hiểu câu hỏi bằng bộ luật."
            className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            Chế độ cơ bản
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Lịch sử trò chuyện"
          title="Lịch sử trò chuyện"
          aria-pressed={historyOpen}
          disabled={busy}
          onClick={() => { setHistoryOpen((prev) => !prev); if (!historyOpen) void refreshHistory(); }}
          className="grid h-7 w-7 place-items-center rounded text-slate-500 transition hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => { newConversation(); setHistoryOpen(false); setDraft(''); inputRef.current?.focus(); }}
          disabled={busy || turns.length === 0}
          aria-label="Hội thoại mới"
          title="Hội thoại mới"
          className="grid h-7 w-7 place-items-center rounded text-slate-500 transition hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={closePanel}
          aria-label="Đóng trợ lý"
          className="grid h-7 w-7 place-items-center rounded text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {notice && (
        <p role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
          {notice}
        </p>
      )}
      {historyError && (
        <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
          {historyError} <button type="button" disabled={busy} onClick={() => void refreshHistory()} className="underline disabled:opacity-50">Thử lại</button>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {historyLoading && <p role="status" className="mb-3 text-xs text-slate-500">Đang tải lịch sử trò chuyện…</p>}
        {historyOpen ? (
          <section aria-label="Các hội thoại đã lưu" className="space-y-3">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Lịch sử trò chuyện</h3>
              <button type="button" onClick={() => setHistoryOpen(false)} className="text-xs text-primary-ink">Quay lại chat</button>
            </div>
            {!historyLoading && conversations.length === 0 && <p className="text-sm text-slate-500">Chưa có hội thoại được lưu.</p>}
            <ul className="space-y-2">{conversations.map((c) => <li key={c.id}>
              <button type="button" disabled={busy} aria-current={activeConversationId === c.id ? 'true' : undefined}
                onClick={() => { void selectConversation(c.id).then((loaded) => { if (loaded) { setHistoryOpen(false); setDraft(''); } }); }}
                className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-primary disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800">
                <span className="block break-words text-sm font-medium">{c.title}</span>
                <span className="mt-1 block text-xs text-slate-500">{c.turnCount} lượt · {new Date(c.updatedAt).toLocaleString('vi-VN')}</span>
              </button>
            </li>)}</ul>
            {historyHasMore && <button type="button" disabled={busy} onClick={() => void refreshHistory(true)} className="text-xs text-primary-ink disabled:opacity-50">Xem thêm hội thoại</button>}
          </section>
        ) : turns.length === 0 ? (
          <Intro busy={busy} status={status} onAsk={(q) => void ask(q)} />
        ) : (
          <>
          {olderHasMore && <button type="button" disabled={busy} onClick={() => {
            const el = scrollRef.current;
            if (el) olderScroll.current = { height: el.scrollHeight, top: el.scrollTop };
            void loadOlder();
          }} className="mb-3 text-xs text-primary-ink disabled:opacity-50">Tải tin nhắn trước</button>}
          <ol aria-label="Hội thoại" className="space-y-4">
            {turns.map((t, i) => (
              <AnswerView
                key={t.id}
                turn={t}
                latest={i === turns.length - 1}
                busy={busy}
                scope={scope}
                onConfirm={(turn) => void confirmAction(turn)}
                onCancel={(turn) => void cancelAction(turn)}
                onChoose={(o) => void choose(o)}
                onMore={(turn, blockId) => void loadMore(turn, blockId)}
                onAsk={(q) => void ask(q)}
              />
            ))}
          </ol>
          </>
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
        {(staged.length > 0 || uploading || uploadError) && (
          <div className="mb-2 space-y-1">
            {staged.length > 0 && (
              <ul aria-label="Tệp chờ gắn" className="flex flex-wrap gap-1.5">
                {staged.map((f) => (
                  <li key={f.id} className="flex max-w-full items-center gap-1 rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-700 dark:border-slate-600 dark:text-slate-200">
                    <span className="truncate">{f.name}</span>
                    <button type="button" aria-label={`Bỏ tệp ${f.name}`} disabled={busy} onClick={() => removeStaged(f.id)} className="text-slate-500 hover:text-red-600 disabled:opacity-40">×</button>
                  </li>
                ))}
              </ul>
            )}
            {uploading && <p role="status" className="text-xs text-slate-500">Đang tải tệp lên…</p>}
            {uploadError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{uploadError}</p>}
          </div>
        )}
        <div className="flex items-end gap-2">
          {status?.actions === true && (
            <>
              <input ref={fileRef} type="file" accept={FILE_ACCEPT} aria-label="Chọn tệp để đính kèm" className="hidden" onChange={(e) => void onPickFile(e)} />
              <button
                type="button"
                aria-label="Đính kèm tệp"
                title="Đính kèm tệp vào một thẻ: chọn tệp rồi gõ lệnh, ví dụ “Đính kèm file này vào thẻ Login”"
                disabled={busy || uploading}
                onClick={() => fileRef.current?.click()}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-300 text-slate-500 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </>
          )}
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onInputKeyDown}
            maxLength={MAX_QUESTION_CHARS}
            rows={2}
            aria-label="Câu hỏi cho trợ lý"
            placeholder={status?.actions === true ? 'Hỏi hoặc ra lệnh, ví dụ: chuyển Login sang Đang làm…' : 'Hỏi về việc của bạn hoặc của nhóm…'}
            className="min-h-0 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={busy || uploading || draft.trim() === ''}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Gửi
          </button>
        </div>
        <div className="mt-1.5 flex items-start justify-between gap-3 text-[11px] text-slate-400 dark:text-slate-500">
          <span>{PRIVACY_NOTE}</span>
          <span className="shrink-0 tabular-nums">
            {draft.length}/{MAX_QUESTION_CHARS}
          </span>
        </div>
      </form>
    </aside>
  );
}
