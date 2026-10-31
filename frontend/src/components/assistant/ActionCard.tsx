import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AssistantTurn } from '../../context/AssistantContext';
import { planOutOfScope } from '../../lib/chatScope';
import { cardLink, formatTime } from '../../lib/chatText';
import { alternativesLine, choiceLine, flagsLine } from '../../lib/chatAssign';
import type { ChatActionPlan, ChatActionResult, ChatPatchSkipped, ChatScope } from '../../types/chat';

// Khoi THAO TAC cua tro ly (Phase 1 + 2): ban xem truoc co nut Ap dung / Huy (mot hoac NHIEU thao tac tren cung mot bang), hoac ket
// qua cua ke hoach da chay. Nhieu thao tac: danh sach danh so, "lam tat ca hoac khong lam gi".
// Moi chu mo ta thao tac do SERVER dung tu ke hoach da phan giai (ten lay tu CSDL) - AI khong viet duoc chu o day.
// Xac nhan CHI bang nut (go "ok" khong chay gi). Vung bao ngoai la aria-live nen ket qua duoc doc khi the xem truoc doi thanh ket qua.

const PANEL_BORDER = 'border-slate-200 dark:border-slate-700';

/** Dong ho cham de nut Ap dung tu khoa khi het han (15 giay mot lan, chi chay khi con co the bam). */
function useNow(active: boolean, everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [active, everyMs]);
  return now;
}

/** Cau giai thich vi sao mot muc AI de xuat khong duoc dua vao ke hoach (server da loc trung tren TOAN BO bang). */
function skippedText(s: ChatPatchSkipped): string {
  const what = s.kind === 'LIST' ? 'Cột' : 'Thẻ';
  const at = s.where ? ` (cột “${s.where}”)` : '';
  switch (s.reason) {
    case 'EXISTS':
      return s.kind === 'LIST' ? `${what} “${s.title}” đã có (“${s.existing ?? s.title}”), dùng cột này` : `${what} “${s.title}” đã có${s.existing ? ` — thẻ “${s.existing}”` : ''}${at}`;
    case 'SIMILAR':
      return `${what} “${s.title}” gần giống thẻ “${s.existing ?? ''}”${at}`;
    case 'DUPLICATE_IN_PATCH':
      return `${what} “${s.title}” trùng một mục khác trong đề xuất`;
    case 'UNKNOWN_LIST':
      return `Thẻ “${s.title}” bị bỏ vì không chọn được cột phù hợp`;
  }
}

function PatchSummary({ patch }: { patch: NonNullable<ChatActionPlan['patch']> }) {
  const parts = [patch.newLists > 0 ? `${patch.newLists} cột mới` : '', patch.newCards > 0 ? `${patch.newCards} thẻ mới` : ''].filter((p) => p !== '');
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-slate-600 dark:text-slate-300">
        <span className="font-medium">Nội dung do AI đề xuất</span>: {parts.join(' · ')}. Chỉ thêm mới, không sửa hay xóa dữ liệu hiện có.
      </p>
      {patch.skipped.length > 0 && (
        <details className="rounded-md border border-slate-200 p-1.5 text-xs dark:border-slate-700">
          <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">Đã có — bỏ qua ({patch.skipped.length})</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-600 dark:text-slate-300">
            {patch.skipped.map((s, i) => <li key={`${i}-${s.title}`} className="break-words">{skippedText(s)}</li>)}
          </ul>
        </details>
      )}
      <p className="text-[11px] text-slate-500 dark:text-slate-400">Không đụng tới: {patch.untouched.cards} thẻ và {patch.untouched.lists} cột hiện có.</p>
    </div>
  );
}

function PlanCard({ turn, plan, scope, busy, onConfirm, onCancel }: {
  turn: AssistantTurn; plan: ChatActionPlan; scope: ChatScope; busy: boolean; onConfirm: (t: AssistantTurn) => void; onCancel: (t: AssistantTurn) => void;
}) {
  const open = plan.status === 'PROPOSED';
  const now = useNow(open);
  const expired = open && (!plan.canConfirm || Date.parse(plan.expiresAt) <= now);
  const wrongPage = open && planOutOfScope(scope, plan.boardId);
  const disabled = !open || expired || wrongPage || busy;
  const count = plan.opCount ?? plan.items.length;
  const multi = count > 1;
  const List = multi ? 'ol' : 'ul';
  const danger = plan.items.some((i) => i.danger === true);
  return (
    <section aria-label="Kế hoạch thao tác" className={`space-y-2 rounded-lg border p-2 ${danger ? 'border-red-300 dark:border-red-500/50' : PANEL_BORDER}`}>
      <h4 className="text-sm font-semibold">
        {plan.patch ? 'Thêm vào bảng' : multi ? `${count} thay đổi trên bảng` : 'Thao tác trên bảng'}{' '}
        <Link to={`/boards/${encodeURIComponent(plan.boardId)}`} onClick={(e) => e.currentTarget.blur()} className="text-primary-ink hover:underline">{plan.boardName}</Link>
      </h4>
      {plan.patch && <PatchSummary patch={plan.patch} />}
      {multi && <p className="text-xs text-slate-500 dark:text-slate-400">Áp dụng là làm tất cả hoặc không làm gì: nếu một bước không làm được thì không có thay đổi nào được ghi.</p>}
      <List className={multi ? 'list-decimal space-y-1.5 pl-5' : 'space-y-1.5'}>
        {plan.items.map((item) => (
          <li key={item.index} className="text-sm">
            <span className={`font-medium ${item.danger === true ? 'text-red-700 dark:text-red-300' : ''}`}>{item.verb}</span>{' '}
            {item.rule ? (
              <span className="block space-y-1">
                <span className="block break-words">{item.rule.when}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">Thì tự động:</span>
                <ul className="list-disc space-y-0.5 pl-5 text-sm">{item.rule.then.map((t) => <li key={t} className="break-words">{t}</li>)}</ul>
                <span className="block break-words text-xs text-slate-500 dark:text-slate-400">{item.rule.note}</span>
              </span>
            ) : (
              <span className="break-words">{item.text}</span>
            )}
            {item.detail && <span className={`block whitespace-pre-line break-words text-xs ${item.danger === true ? 'text-red-700 dark:text-red-300' : 'text-slate-500 dark:text-slate-400'}`}>{item.detail}</span>}
            {item.choice && <span className="block text-xs text-slate-500 dark:text-slate-400">{choiceLine(item.choice)}</span>}
            {item.choice && item.choice.flags.length > 0 && <span className="block text-xs text-amber-700 dark:text-amber-300">{flagsLine(item.choice.flags)}</span>}
            {item.choice && item.choice.alternatives.length > 0 && <span className="block break-words text-xs text-slate-500 dark:text-slate-400">{alternativesLine(item.choice.alternatives)}</span>}
            {item.cardId && (
              <Link to={cardLink({ id: item.cardId, boardId: plan.boardId })} onClick={(e) => e.currentTarget.blur()} className="text-xs text-primary-ink hover:underline">Mở thẻ</Link>
            )}
          </li>
        ))}
      </List>
      {plan.reasons.length > 0 && (
        <div role="note" className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
          <p className="font-medium">Cần bạn xem lại trước khi áp dụng</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{plan.reasons.map((r) => <li key={r.code}>{r.text}</li>)}</ul>
        </div>
      )}
      {plan.warnings.map((w) => <p key={w} className="text-xs text-amber-700 dark:text-amber-300">{w}</p>)}
      {open && !expired && !wrongPage && <p className="text-[11px] text-slate-500 dark:text-slate-400">Chưa có gì thay đổi. Kế hoạch hết hạn lúc {formatTime(plan.expiresAt)}.</p>}
      {plan.status === 'EXECUTING' && <p className="text-xs text-slate-600 dark:text-slate-300">Kế hoạch đang được thực hiện…</p>}
      {expired && <p className="text-xs text-slate-600 dark:text-slate-300">Kế hoạch đã hết hạn. Hãy gửi lại lệnh. Chưa thay đổi gì.</p>}
      {wrongPage && <p className="text-xs text-slate-600 dark:text-slate-300">Kế hoạch này thuộc bảng khác với bảng đang mở nên không áp dụng được ở đây. Chưa thay đổi gì.</p>}
      {turn.actionError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{turn.actionError}</p>}
      {open && (
        <div className="flex gap-2">
          <button type="button" disabled={disabled} onClick={() => onConfirm(turn)} className={`flex-1 rounded-md py-1.5 text-xs font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary-hover'}`}>
            {turn.actionBusy ? 'Đang áp dụng…' : multi ? `Áp dụng ${count} thay đổi` : 'Áp dụng'}
          </button>
          <button type="button" disabled={busy || expired} onClick={() => onCancel(turn)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700">
            Hủy
          </button>
        </div>
      )}
    </section>
  );
}

const RESULT_LABEL: Record<ChatActionResult['status'], { text: string; tone: string }> = {
  EXECUTED: { text: 'Đã thực hiện', tone: 'text-emerald-700 dark:text-emerald-300' },
  FAILED: { text: 'Chưa thực hiện được', tone: 'text-red-600 dark:text-red-400' },
  STALE: { text: 'Dữ liệu đã thay đổi', tone: 'text-amber-700 dark:text-amber-300' },
  CANCELLED: { text: 'Đã hủy', tone: 'text-slate-600 dark:text-slate-300' },
  EXPIRED: { text: 'Đã hết hạn', tone: 'text-slate-600 dark:text-slate-300' },
};

function ResultCard({ result }: { result: ChatActionResult }) {
  const label = RESULT_LABEL[result.status];
  return (
    <section aria-label="Kết quả thao tác" className={`space-y-1 rounded-lg border p-2 ${PANEL_BORDER}`}>
      <p className={`text-xs font-medium ${label.tone}`}>
        {label.text}
        {result.autoExecuted && result.status === 'EXECUTED' && ' · theo lệnh của bạn'}
      </p>
      <p className="break-words text-sm">{result.summary}</p>
      {result.details && result.details.length > 1 && (
        <ol className="list-decimal space-y-0.5 pl-5 text-sm text-slate-700 dark:text-slate-200">
          {result.details.map((line, i) => <li key={`${i}-${line}`} className="break-words">{line}</li>)}
        </ol>
      )}
      {result.alreadyApplied && <p className="text-[11px] text-slate-500 dark:text-slate-400">Kế hoạch này đã được áp dụng trước đó, không ghi thêm lần nữa.</p>}
      {result.warnings.map((w) => <p key={w} className="text-xs text-amber-700 dark:text-amber-300">{w}</p>)}
      {result.status === 'EXECUTED' && result.cardId && (
        <Link to={cardLink({ id: result.cardId, boardId: result.boardId })} onClick={(e) => e.currentTarget.blur()} className="text-xs text-primary-ink hover:underline">Mở thẻ</Link>
      )}
    </section>
  );
}

export default function ActionCard({ turn, scope, busy, onConfirm, onCancel }: {
  turn: AssistantTurn; scope: ChatScope; busy: boolean; onConfirm: (t: AssistantTurn) => void; onCancel: (t: AssistantTurn) => void;
}) {
  const action = turn.reply?.answer.action;
  if (!action) return null;
  return (
    <div aria-live="polite">
      {action.kind === 'PLAN'
        ? <PlanCard turn={turn} plan={action.plan} scope={scope} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />
        : <ResultCard result={action.result} />}
    </div>
  );
}
