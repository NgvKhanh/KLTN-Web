import { Link } from 'react-router-dom';
import type { AssistantTurn } from '../../context/AssistantContext';
import { cardLink, formatDate, formatDateTime, formatTime, parserText, REASON_TEXT, remainingCards, understoodText } from '../../lib/chatText';
import type { ChatAnswer, ChatCard, ChatClarifyOption, ChatScope, ChatTable, ChatWorkloadRow } from '../../types/chat';
import StatusBadge from '../board/StatusBadge';
import V2AnswerView from './V2AnswerView';

// Mot luot hoi - dap (§13): cau hoi, dong "Trợ lý hiểu là", cau dan, con so, danh sach the co lien
// ket, "Xem thêm", nut hoi lai, cau hoi goi y; nhan xet AI nam o rieng, tach khoi so lieu.

function CardRow({ card, refIso }: { card: ChatCard; refIso: string }) {
  const due = card.dueDate ? formatDateTime(card.dueDate, refIso) : null;
  return (
    <li>
      <Link
        to={cardLink(card)}
        // Bo focus khoi panel: the mo ra (CardModal, de len panel) nghe Esc o document - neu con tro
        // con o lien ket trong panel thi Esc se dong panel thay vi dong the
        onClick={(e) => e.currentTarget.blur()}
        className="block rounded-lg border border-slate-200 bg-white px-3 py-2 transition hover:border-primary/50 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/60"
      >
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-sm font-medium text-slate-800 dark:text-slate-100">{card.title}</span>
          <StatusBadge status={card.status} />
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="truncate">
            {card.boardName} · {card.listName}
          </span>
          {card.reason && (
            <span className="rounded bg-amber-100 px-1 font-medium text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">
              {REASON_TEXT[card.reason]}
            </span>
          )}
          {due && (
            <span className={card.overdue ? 'font-medium text-red-600 dark:text-red-400' : undefined}>
              {card.overdue ? `Quá hạn · ${due}` : `Hạn ${due}`}
            </span>
          )}
          {card.checklistTotal > 0 && (
            <span>
              Checklist {card.checklistDone}/{card.checklistTotal}
            </span>
          )}
          {card.assignees.length > 0 && <span className="truncate">{card.assignees.join(', ')}</span>}
        </span>
      </Link>
    </li>
  );
}

function WorkloadTable({ rows, refIso }: { rows: ChatWorkloadRow[]; refIso: string }) {
  const leader = rows.some((r) => 'capacity' in r);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-slate-500 dark:text-slate-400">
          <tr>
            <th className="py-1 pr-2 font-medium">Thành viên</th>
            <th className="py-1 pr-2 text-right font-medium">Chưa xong</th>
            <th className="py-1 pr-2 text-right font-medium">Quá hạn</th>
            {leader && <th className="py-1 pr-2 text-right font-medium">Song song tối đa</th>}
            {leader && <th className="py-1 font-medium">Tạm nghỉ đến</th>}
          </tr>
        </thead>
        <tbody className="text-slate-700 dark:text-slate-200">
          {rows.map((r) => (
            <tr key={r.userId} className="border-t border-slate-100 dark:border-slate-700">
              <td className="py-1 pr-2">{r.name}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{r.open}</td>
              <td className={`py-1 pr-2 text-right tabular-nums ${r.overdue > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{r.overdue}</td>
              {leader && <td className="py-1 pr-2 text-right tabular-nums">{r.capacity ?? 'mặc định'}</td>}
              {leader && <td className="py-1">{r.pausedUntil ? formatDate(r.pausedUntil, refIso) : '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bang ket qua chung cua cau tra loi danh muc (§18): dong co boardId la lien ket mo bang; so canh phai. */
function AnswerTable({ table }: { table: ChatTable }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <tr>
            {table.columns.map((c, i) => (
              <th key={c} className={`px-2 py-1 font-medium ${typeof table.rows[0]?.cells[i] === 'number' ? 'text-right' : ''}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-slate-700 dark:text-slate-200">
          {table.rows.map((r, ri) => (
            <tr key={`${ri}-${r.boardId ?? ''}`} className="border-t border-slate-100 dark:border-slate-700">
              {r.cells.map((cell, ci) => (
                <td key={ci} className={`px-2 py-1 ${typeof cell === 'number' ? 'text-right tabular-nums' : ''}`}>
                  {ci === 0 && r.boardId ? (
                    <Link
                      to={`/boards/${encodeURIComponent(r.boardId)}`}
                      // giong lien ket the: bo focus khoi panel de Esc khong dong panel khi bang mo ra
                      onClick={(e) => e.currentTarget.blur()}
                      className="font-medium text-primary-ink hover:underline"
                    >
                      {cell}
                    </Link>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Suggestions({ items, disabled, onAsk }: { items: string[]; disabled: boolean; onAsk: (q: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((q) => (
        <button
          key={q}
          type="button"
          disabled={disabled}
          onClick={() => onAsk(q)}
          className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:border-primary hover:text-primary-ink disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
        >
          {q}
        </button>
      ))}
    </div>
  );
}

function AnswerBody({
  turn,
  answer,
  latest,
  busy,
  onChoose,
  onMore,
  onAsk,
}: {
  turn: AssistantTurn;
  answer: ChatAnswer;
  latest: boolean;
  busy: boolean;
  onChoose: (o: ChatClarifyOption) => void;
  onMore: (t: AssistantTurn, blockId?: string) => void;
  onAsk: (q: string) => void;
}) {
  const understood = turn.reply!.understood;
  const left = remainingCards(answer, turn.cards.length);
  return (
    <div className="space-y-2.5">
      {answer.kind !== 'UNSUPPORTED' && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Trợ lý hiểu là: <span className="font-medium text-slate-700 dark:text-slate-200">{understoodText(understood)}</span>
          {' · '}
          hiểu bằng {parserText(understood.parser)}
        </p>
      )}
      <p className="whitespace-pre-line text-sm text-slate-800 dark:text-slate-100">{answer.text}</p>

      {answer.facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-1.5">
          {answer.facts.map((f) => (
            <div key={f.key} className="rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-800">
              <dt className="text-[11px] text-slate-500 dark:text-slate-400">{f.label}</dt>
              <dd className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {answer.rows && answer.rows.length > 0 && <WorkloadTable rows={answer.rows} refIso={answer.generatedAt} />}

      {answer.table && answer.table.rows.length > 0 && <AnswerTable table={answer.table} />}

      {turn.cards.length > 0 && (
        <ul aria-label="Danh sách việc" className="space-y-1.5">
          {turn.cards.map((c) => (
            <CardRow key={c.id} card={c} refIso={answer.generatedAt} />
          ))}
        </ul>
      )}
      {left > 0 && latest && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onMore(turn)}
          className="w-full rounded-md border border-slate-300 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {turn.loadingMore ? 'Đang tải thêm…' : `Xem thêm (còn ${left} việc)`}
        </button>
      )}
      {left > 0 && !latest && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Còn {left} việc chưa hiện — hỏi lại để xem đầy đủ.
        </p>
      )}
      {turn.moreError && <p className="text-xs text-red-600 dark:text-red-400">{turn.moreError}</p>}

      {answer.sections.map((s) => (
        <section key={s.key} aria-label={s.label} className="space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            {s.label} ({s.total})
          </h4>
          {s.cards.length > 0 && (
            <ul className="space-y-1.5">
              {s.cards.map((c) => (
                <CardRow key={c.id} card={c} refIso={answer.generatedAt} />
              ))}
            </ul>
          )}
          {s.total > s.cards.length && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">và {s.total - s.cards.length} việc khác.</p>
          )}
        </section>
      ))}

      {answer.comment && (
        <aside
          aria-label="Nhận xét của trợ lý (AI)"
          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 dark:border-violet-400/30 dark:bg-violet-400/10"
        >
          <p className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">Nhận xét của trợ lý (AI)</p>
          <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{answer.comment.text}</p>
        </aside>
      )}

      {answer.clarify && answer.clarify.options.length > 0 && (
        <div role="group" aria-label={answer.clarify.question} className="flex flex-wrap gap-1.5">
          {answer.clarify.options.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={!latest || busy}
              onClick={() => onChoose(o)}
              className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {answer.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-500 dark:text-slate-400">
          {answer.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {latest && <Suggestions items={answer.suggestions} disabled={busy} onAsk={onAsk} />}

      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        {answer.scopeLabel} Lúc {formatTime(answer.generatedAt)}.
      </p>
    </div>
  );
}

export default function AnswerView(props: {
  turn: AssistantTurn;
  latest: boolean;
  busy: boolean;
  /** Pham vi theo trang dang mo (khoi thao tac dung de vo hieu ke hoach cua bang khac). */
  scope: ChatScope;
  onConfirm: (t: AssistantTurn) => void;
  onCancel: (t: AssistantTurn) => void;
  onChoose: (o: ChatClarifyOption) => void;
  onMore: (t: AssistantTurn, blockId?: string) => void;
  onAsk: (q: string) => void;
}) {
  const { turn } = props;
  return (
    <li className="space-y-2">
      <div className="ml-auto w-fit max-w-[85%] space-y-1">
        <p className="rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-white">{turn.question}</p>
        {turn.files && turn.files.length > 0 && (
          <p className="text-right text-[11px] text-slate-500 dark:text-slate-400">Tệp đính kèm: {turn.files.join(', ')}</p>
        )}
      </div>
      <div className="rounded-2xl rounded-bl-sm border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/60">
        {turn.status === 'loading' && (
          <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
            Đang tra cứu dữ liệu…
          </p>
        )}
        {turn.status === 'error' && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {turn.error}
          </p>
        )}
        {turn.status === 'done' && turn.reply && (turn.reply.answer.blocks ? <V2AnswerView {...props} /> : <AnswerBody {...props} answer={turn.reply.answer} />)}
      </div>
    </li>
  );
}
