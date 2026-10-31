import { Link } from 'react-router-dom';
import type { AssistantTurn } from '../../context/AssistantContext';
import type { ChatV2Block, ChatV2Event, ChatClarifyOption, ChatScope } from '../../types/chat';
import { cardLink, formatDateTime } from '../../lib/chatText';
import StatusBadge from '../board/StatusBadge';
import ActionCard from './ActionCard';
import { AssigneeSuggestionBlock, BoardCatalogRows, BoardOverviewBlock, CardDetailsBlock, QueryDataBlock } from './V2ReadBlocks';

const EVENT_NAMES: Record<string, string> = { 'card.rename': 'Đổi tên', 'card.move': 'Chuyển cột', 'card.done': 'Hoàn thành', 'card.undone': 'Mở lại', 'card.status': 'Đổi trạng thái', 'card.due.set': 'Đặt hạn', 'card.due.clear': 'Bỏ hạn', 'member.add': 'Thêm người phụ trách', 'member.remove': 'Bỏ người phụ trách', 'card.archive': 'Lưu trữ', 'card.restore': 'Khôi phục', 'card.create': 'Tạo thẻ', 'comment.create': 'Bình luận', 'checklist.add': 'Thêm checklist', 'attachment.add': 'Thêm tệp' };
function EventRow({ event }: { event: ChatV2Event }) {
  const date = (v: string) => /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)) ? formatDateTime(v, event.createdAt) : v;
  const value = (v: string | null | undefined) => v === undefined ? 'không ghi nhận' : v === null ? 'không có' : date(v);
  const detail = event.data.from !== undefined || event.data.to !== undefined
    ? `${value(event.data.from)} → ${value(event.data.to)}`
    : event.data.dueDate ? `Hạn: ${date(event.data.dueDate)}` : event.data.memberName ?? event.data.toList ?? '';
  return <li className="text-xs text-slate-600 dark:text-slate-300">
    <span>{formatDateTime(event.createdAt, event.createdAt)} · {event.actor?.name ?? 'Tài khoản không còn hiển thị'} · {EVENT_NAMES[event.type] ?? event.type}</span>
    {detail && <p className="break-words">{detail}</p>}{event.redacted && <p>Nội dung không còn được phép xem.</p>}
  </li>;
}
const OP_TEXT: Record<string, string> = { EQ: '=', NE: '≠', IN: 'trong', CONTAINS: 'chứa', BEFORE: 'trước', ON_OR_AFTER: 'từ', BETWEEN: 'từ…đến', GT: '>', LT: '<', IS_NULL: 'chưa có', NOT_NULL: 'đã có' };
/** Dieu kien cua truy van tong quat, doc duoc bang tieng Viet. Gia tri la id (…Id) khong hien vi vo nghia voi nguoi dung. */
function dataConditions(input: Record<string, unknown>): string[] {
  const where = Array.isArray(input.where) ? input.where as Array<{ field?: string; op?: string; value?: string; values?: string[] }> : [];
  const words = where.map((c) => {
    const field = String(c.field ?? '');
    const shown = /Id$/.test(field) ? '' : c.values ? c.values.join(' … ') : c.value ?? '';
    return `${field} ${OP_TEXT[String(c.op)] ?? c.op}${shown ? ` ${shown}` : ''}`;
  });
  if (typeof input.search === 'string') words.unshift(`Tìm “${input.search}”`);
  return words;
}
function Conditions({ block }: { block: Extract<ChatV2Block, { status: 'OK' }> }) {
  const input = block.source.appliedInput;
  if (block.tool === 'query_data') return <p className="text-[11px] text-slate-500 dark:text-slate-400">{dataConditions(input).join(' · ')}</p>;
  const f = (input.filters ?? input.taskFilters) as Record<string, unknown> | undefined;
  const words = [f?.completion === 'ALL' ? 'Tính cả việc đã xong' : f?.completion === 'DONE' ? 'Chỉ việc đã xong' : f?.completion === 'OPEN' ? 'Chỉ việc chưa xong' : '',
    f?.overdue ? 'Quá hạn' : '', Array.isArray(f?.fieldOptionIds) ? 'Theo giá trị trường tùy chỉnh' : '', Array.isArray(f?.statuses) ? `Trạng thái: ${f.statuses.join(', ')}` : '', f?.keyword ? `Từ khóa: ${String(f.keyword)}` : ''].filter(Boolean);
  const dateField = (f?.date as { field?: string } | undefined)?.field;
  if (dateField) words.push(`Ngày ${dateField === 'DUE' ? 'hạn' : dateField === 'COMPLETED' ? 'hoàn thành' : 'tạo'}`);
  return <p className="text-[11px] text-slate-500 dark:text-slate-400">{words.join(' · ')}</p>;
}
function Contents({ block }: { block: Extract<ChatV2Block, { status: 'OK' }> }) {
  if (block.tool === 'get_board_overview') return <BoardOverviewBlock data={block.data} />;
  if (block.tool === 'suggest_assignee') return <AssigneeSuggestionBlock data={block.data} />;
  if (block.tool === 'get_card_details') return <CardDetailsBlock data={block.data} generatedAt={block.source.generatedAt} />;
  if (block.tool === 'query_data') return <QueryDataBlock data={block.data} generatedAt={block.source.generatedAt} />;
  if (block.tool === 'query_tasks') return <>
    <p className="text-xs font-medium">Tổng: {block.data.total} công việc</p>
    {block.data.total === 0 && <p className="text-xs">Không có công việc khớp điều kiện.</p>}
    <ul className="space-y-1.5">{block.data.cards.map((c) => <li key={c.id}>
      <Link to={cardLink(c)} onClick={(e) => e.currentTarget.blur()} className="block rounded-lg border border-slate-200 bg-white p-2 hover:border-primary dark:border-slate-700 dark:bg-slate-800">
        <span className="flex items-start gap-2"><span className="min-w-0 flex-1 break-words text-sm font-medium">{c.title}</span><StatusBadge status={c.status} /></span>
        <span className="mt-1 block text-[11px] text-slate-500">{c.boardName} · {c.columnName}</span>
        <span className="block text-[11px] text-slate-500">{c.assignees.map((a) => a.name).join(', ') || 'Không có thành viên đang hoạt động hiển thị'}</span>
        {c.dueDate && <span className={`block text-[11px] ${c.overdue ? 'text-red-600' : 'text-slate-500'}`}>{c.overdue ? 'Quá hạn' : 'Hạn'} · {formatDateTime(c.dueDate, block.source.generatedAt)}</span>}
      </Link>
    </li>)}</ul>
  </>;
  if (block.tool === 'aggregate_tasks') {
    const d = block.data; const leaders = d.rows.filter((r) => d.leaderIds.includes(r.id));
    return <>
      <p className="text-xs">Tổng: {d.totalCards} công việc duy nhất.</p>
      {d.donePercent !== null && d.donePercent !== undefined && <p className="text-xs font-medium">Đã hoàn thành {d.doneCards}/{d.totalCards} việc ({d.donePercent}%)</p>}
      {d.groupBy === 'ASSIGNEE' && <p className="text-xs font-medium">{d.highestCount === 0 ? 'Chưa có thành viên nào giữ việc khớp điều kiện.' : `Nhiều việc nhất${d.leaderIds.length > 1 ? ' (đồng hạng)' : ''}: ${leaders.map((r) => r.label).join(', ')}${d.leaderIds.length > leaders.length ? ` và ${d.leaderIds.length - leaders.length} người đồng hạng khác (xem thêm)` : ''} — ${d.highestCount} việc/người.`}</p>}
      <table className="w-full text-xs"><thead><tr><th className="text-left">{d.groupBy === 'ASSIGNEE' ? 'Thành viên' : 'Nhóm'}</th><th className="text-right">Số việc</th></tr></thead><tbody>{d.rows.map((r) => <tr key={r.id} className="border-t border-slate-200 dark:border-slate-700"><td className="py-1">{r.label}</td><td className="text-right tabular-nums">{r.count}</td></tr>)}</tbody></table>
      {d.groupBy === 'ASSIGNEE' && <p className="text-[11px] text-slate-500">Chưa giao: {d.unassignedCards}. Ngoài nhóm hiện tại: {d.outsideAssignments} lượt giao. Tài khoản đã xóa: {d.deletedAccountAssignments} lượt giao. {d.assignmentCounting}</p>}
    </>;
  }
  if (block.tool === 'query_activities') return <>
    <p className="text-xs">{block.data.changedCardCount} công việc · {block.data.eventCount} sự kiện</p><p className="text-[11px] text-slate-500">{block.data.coverage}</p>
    {block.data.total === 0 && <p className="text-xs">Không có nhật ký khớp điều kiện.</p>}
    {block.data.mode === 'EVENTS' ? <ul className="space-y-2">{block.data.events.map((e) => <li key={e.id}><p className="text-xs font-medium">{e.cardTitle ?? 'Nội dung thẻ không còn hiển thị'}</p><ul><EventRow event={e} /></ul></li>)}</ul>
      : <ul className="space-y-3">{block.data.cards.map((c) => <li key={c.id}>
        <p className="text-xs font-medium">{c.title && c.events[0]?.boardId ? <Link to={cardLink({ id: c.id, boardId: c.events[0].boardId })} onClick={(e) => e.currentTarget.blur()} className="text-primary-ink hover:underline">{c.title}</Link> : 'Nội dung thẻ không còn hiển thị'} ({c.eventCount} sự kiện)</p>
        <ul className="mt-1 space-y-1">{c.events.map((e) => <EventRow key={e.id} event={e} />)}</ul>
        {c.eventsTruncated && <p className="text-[11px] text-slate-500">Hiển thị 5 sự kiện gần nhất của công việc này.</p>}
      </li>)}</ul>}
  </>;
  const d = block.data;
  if (d.kind === 'LISTS' || d.kind === 'LABELS' || d.kind === 'CUSTOM_FIELDS') return <BoardCatalogRows data={d} />;
  return <><p className="text-xs">Tổng: {d.total}</p><ul className="space-y-1 text-xs">{d.rows.map((r) => <li key={r.id}>{d.kind === 'BOARDS' ? <Link className="text-primary-ink hover:underline" to={`/boards/${encodeURIComponent(r.id)}`}>{r.name}</Link> : r.name}</li>)}</ul></>;
}
export default function V2AnswerView({ turn, latest, busy, scope, onMore, onChoose, onConfirm, onCancel }: {
  turn: AssistantTurn; latest: boolean; busy: boolean; scope: ChatScope; onMore: (t: AssistantTurn, blockId?: string) => void; onChoose: (o: ChatClarifyOption) => void;
  onConfirm: (t: AssistantTurn) => void; onCancel: (t: AssistantTurn) => void;
}) {
  const answer = turn.reply!.answer;
  // Ket qua thao tac da co cau tom tat trong khoi ket qua: khong lap lai cung mot cau o dong dan
  const echoed = answer.action?.kind === 'RESULT' && answer.action.result.summary === answer.text;
  return <div className="space-y-3 text-slate-700 dark:text-slate-200">
    {turn.reply?.mode === 'BASIC' && <p className="text-[11px] text-slate-500">Chế độ cơ bản · dùng các truy vấn có sẵn</p>}{answer.aiAnswer ? <section aria-label="Trả lời của trợ lý (AI)" className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 dark:border-violet-400/30 dark:bg-violet-400/10"><p className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">Trả lời của trợ lý (AI)</p><p className="mt-0.5 whitespace-pre-line break-words text-sm text-slate-700 dark:text-slate-200">{answer.aiAnswer.text}</p><p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{answer.blocks?.some((b) => b.status === 'OK') ? 'Số liệu và tên đã được đối chiếu với dữ liệu tra cứu bên dưới.' : 'Đây là câu trả lời chung, không dùng dữ liệu công việc.'}</p></section> : !echoed && <p className="text-sm">{answer.text}</p>}
    {answer.blocks?.map((b) => <section key={b.id} aria-label={b.title} className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
      <h4 className="text-sm font-semibold">{b.title}</h4>
      {b.status === 'ERROR' ? <p role="alert" className="text-xs text-red-600">{b.error}</p> : <>
        <p className="text-xs font-medium">Phạm vi: {b.source.scope.kind === 'BOARD' ? <Link to={`/boards/${encodeURIComponent(b.source.scope.boardId)}`} className="text-primary-ink hover:underline">{b.source.scopeLabel}</Link> : b.source.scopeLabel}</p>
        <Conditions block={b} /><Contents block={b} />
        {b.pagination.page > 1 && <p className="text-[11px] text-slate-500">Các trang được tra cứu ở từng thời điểm; dữ liệu có thể thay đổi giữa các lần xem thêm.</p>}
        {b.pagination.hasMore && <button type="button" disabled={!latest || busy} onClick={() => onMore(turn, b.id)} className="w-full rounded-md border border-slate-300 py-1 text-xs hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700">{turn.loadingBlockId === b.id ? 'Đang tải thêm…' : `Xem thêm: ${b.title}`}</button>}
        {b.source.ranges.map((r, i) => <p key={i} className="text-[11px] text-slate-500">Từ {formatDateTime(r.from, r.from)} đến trước {formatDateTime(r.to, r.to)} (giờ Việt Nam).</p>)}
        <details className="text-[11px] text-slate-500"><summary className="cursor-pointer">Nguồn và thời điểm tra cứu</summary><p>{b.source.scopeLabel} · {formatDateTime(b.source.generatedAt, b.source.generatedAt)}</p></details>
      </>}
    </section>)}
    {answer.comment && <aside aria-label="Nhận xét của trợ lý (AI)" className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 dark:border-violet-400/30 dark:bg-violet-400/10"><p className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">Nhận xét của trợ lý (AI)</p><p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{answer.comment.text}</p></aside>}
    {answer.action && <ActionCard turn={turn} scope={scope} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />}
    {answer.clarify && <div role="group" aria-label={answer.clarify.question} className="flex flex-wrap gap-1.5">{answer.clarify.options.map((o) => <button key={o.id} type="button" disabled={!latest || busy} onClick={() => onChoose(o)} className="rounded-full bg-primary px-3 py-1 text-xs text-white disabled:opacity-50">{o.label}</button>)}</div>}
    {turn.moreError && <p role="alert" className="text-xs text-red-600">{turn.moreError}</p>}{answer.notes.map((n) => <p key={n} className="text-xs text-amber-700 dark:text-amber-300">{n}</p>)}
  </div>;
}
