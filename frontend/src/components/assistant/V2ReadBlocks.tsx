import { Link } from 'react-router-dom';
import { cardLink, formatDateTime } from '../../lib/chatText';
import { CONFIDENCE_LABEL } from '../../lib/assignLabels';
import { flagsLine } from '../../lib/chatAssign';
import type { AssignConfidenceLevel } from '../../types/assign';
import type { CardStatus } from '../../types/card';
import type { ChatV2AssigneeSuggestion, ChatV2BoardOverview, ChatV2Block, ChatV2CardDetails, ChatV2DataColumn, ChatV2ListStat } from '../../types/chat';

type CatalogData = Extract<ChatV2Block, { tool: 'query_catalog' }>['data'];
import StatusBadge from '../board/StatusBadge';

// Khoi DOC mo rong (Phase 4): tong quan mot bang, chi tiet mot the, cot / nhan / truong tuy chinh cua bang.
// Moi con so va ten do SERVER dung tu CSDL (React tu thoat ky tu). Trich mo ta the la noi dung do NGUOI KHAC viet nen hien trong khung
// "chua dang tin" va khong bao gio duoc dung nhu chi dan.

const TILE = 'rounded-md border border-slate-200 p-2 dark:border-slate-700';

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' | 'danger' }) {
  const color = tone === 'danger' ? 'text-red-600 dark:text-red-400' : tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : '';
  return (
    <div className={TILE}>
      <dt className="text-[11px] text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${color}`}>{value}</dd>
    </div>
  );
}

/** Thanh tien do don gian: ty le nguyen 0-100 (null = chua co the nao). */
function Progress({ percent }: { percent: number | null }) {
  if (percent === null) return <p className="text-xs text-slate-500 dark:text-slate-400">Bảng chưa có thẻ nào nên chưa tính được tiến độ.</p>;
  return (
    <div>
      <div role="progressbar" aria-label="Tiến độ hoàn thành" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function ListStatsTable({ lists }: { lists: ChatV2ListStat[] }) {
  if (lists.length === 0) return <p className="text-xs">Bảng chưa có cột nào.</p>;
  return (
    <table className="w-full text-xs">
      <thead><tr><th className="text-left">Cột</th><th className="text-right">Chưa xong</th><th className="text-right">Đã xong</th></tr></thead>
      <tbody>
        {lists.map((l) => (
          <tr key={l.id} className="border-t border-slate-200 dark:border-slate-700">
            <td className="py-1 pr-2 break-words">{l.name}</td>
            <td className="text-right tabular-nums">{l.openCards}</td>
            <td className="text-right tabular-nums">{l.doneCards}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Phase 6: xep hang nguoi phu hop cho mot viec (module phan cong). Khong co bang chung / ho so / CV. */
export function AssigneeSuggestionBlock({ data }: { data: ChatV2AssigneeSuggestion }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs">
        Việc <Link to={cardLink(data.card)} onClick={(e) => e.currentTarget.blur()} className="font-medium text-primary-ink hover:underline">{data.card.title}</Link> · {data.card.columnName} · {data.candidateCount} người có thể nhận
      </p>
      {data.candidates.length === 0 ? <p className="text-xs">Chưa có ứng viên nào.</p> : (
        <ol className="space-y-1.5">
          {data.candidates.map((c) => (
            <li key={c.user.id} className={TILE}>
              <p className="text-sm"><span className="tabular-nums text-slate-500 dark:text-slate-400">#{c.rank}</span> <span className="font-medium">{c.user.name}</span>{c.assigned ? <span className="text-xs text-slate-500 dark:text-slate-400"> · đã ở trong thẻ</span> : null}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{c.score === null ? 'Chưa đủ dữ liệu để chấm điểm' : `Điểm ${c.score}/100`} · {CONFIDENCE_LABEL[c.confidenceLevel as AssignConfidenceLevel]} · đang giữ {c.load}/{c.capacity} thẻ</p>
              {c.flags.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">{flagsLine(c.flags)}</p>}
            </li>
          ))}
        </ol>
      )}
      <p className="text-[11px] text-slate-500 dark:text-slate-400">Điểm là so sánh TƯƠNG ĐỐI giữa các ứng viên của việc này, chỉ để tham khảo. Muốn giao, hãy nói “giao cho người phù hợp nhất” hoặc nêu tên.</p>
    </div>
  );
}

export function BoardOverviewBlock({ data }: { data: ChatV2BoardOverview }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">
        {data.donePercent === null ? 'Chưa có thẻ nào' : `Đã hoàn thành ${data.doneCards}/${data.totalCards} việc (${data.donePercent}%)`}
      </p>
      <Progress percent={data.donePercent} />
      <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <Tile label="Tổng số việc" value={data.totalCards} />
        <Tile label="Chưa xong" value={data.openCards} />
        <Tile label="Quá hạn" value={data.overdueCards} tone={data.overdueCards > 0 ? 'danger' : undefined} />
        <Tile label="Bị chặn" value={data.blockedCards} tone={data.blockedCards > 0 ? 'warn' : undefined} />
        <Tile label="Chưa giao (chưa xong)" value={data.unassignedOpenCards} />
        <Tile label="Thành viên" value={data.memberCount} />
      </dl>
      <ListStatsTable lists={data.lists} />
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {data.listCount} cột · {data.labelCount} nhãn · {data.customFieldCount} trường tùy chỉnh
      </p>
    </div>
  );
}

export function CardDetailsBlock({ data, generatedAt }: { data: ChatV2CardDetails; generatedAt: string }) {
  const people = data.assignees.map((a) => a.name).join(', ');
  return (
    <div className="space-y-1.5">
      <p className="flex items-start gap-2">
        <Link to={cardLink(data)} onClick={(e) => e.currentTarget.blur()} className="min-w-0 flex-1 break-words text-sm font-medium text-primary-ink hover:underline">{data.title}</Link>
        <StatusBadge status={data.status} />
      </p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{data.boardName} · {data.columnName}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-500 dark:text-slate-400">Người phụ trách</dt>
        <dd>{people || 'Chưa giao'}</dd>
        <dt className="text-slate-500 dark:text-slate-400">Hạn</dt>
        <dd className={data.overdue ? 'text-red-600 dark:text-red-400' : ''}>{data.dueDate ? `${data.overdue ? 'Quá hạn · ' : ''}${formatDateTime(data.dueDate, generatedAt)}` : 'Chưa đặt hạn'}</dd>
        {data.startDate && (<><dt className="text-slate-500 dark:text-slate-400">Bắt đầu</dt><dd>{formatDateTime(data.startDate, generatedAt)}</dd></>)}
        {data.completedAt && (<><dt className="text-slate-500 dark:text-slate-400">Hoàn thành</dt><dd>{formatDateTime(data.completedAt, generatedAt)}</dd></>)}
        <dt className="text-slate-500 dark:text-slate-400">Checklist</dt>
        <dd>{data.checklist.total === 0 ? 'Không có' : `${data.checklist.done}/${data.checklist.total} mục (${data.checklist.lists} danh sách)`}</dd>
        <dt className="text-slate-500 dark:text-slate-400">Bình luận · Tệp</dt>
        <dd>{data.commentCount} · {data.attachmentCount}</dd>
      </dl>
      {data.labels.length > 0 && (
        <ul aria-label="Nhãn" className="flex flex-wrap gap-1">
          {data.labels.map((l) => (
            <li key={l.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] dark:border-slate-700">
              <span aria-hidden className="inline-block size-2 rounded-full" style={{ backgroundColor: l.color }} />
              {l.name || 'Nhãn không tên'}
            </li>
          ))}
        </ul>
      )}
      {data.fields.length > 0 && (
        <dl aria-label="Trường tùy chỉnh" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {data.fields.map((f) => (<div key={f.id} className="contents"><dt className="text-slate-500 dark:text-slate-400">{f.name}</dt><dd className="break-words">{f.value}</dd></div>))}
        </dl>
      )}
      {data.descriptionExcerpt && (
        <figure className="rounded-md bg-slate-50 p-2 dark:bg-slate-800/60">
          <figcaption className="text-[11px] text-slate-500 dark:text-slate-400">
            Trích mô tả (nội dung do người khác viết, chưa đáng tin){data.descriptionLength > data.descriptionExcerpt.length ? ` · ${data.descriptionLength} ký tự, chỉ hiện phần đầu` : ''}
          </figcaption>
          <blockquote className="mt-0.5 whitespace-pre-wrap break-words text-xs">{data.descriptionExcerpt}</blockquote>
        </figure>
      )}
    </div>
  );
}

const FIELD_TYPE: Record<string, string> = { TEXT: 'Văn bản', NUMBER: 'Số', DATE: 'Ngày', CHECKBOX: 'Hộp chọn', DROPDOWN: 'Danh sách chọn' };

export function BoardCatalogRows({ data }: { data: CatalogData }) {
  if (data.kind === 'LISTS') return <><p className="text-xs">Tổng: {data.total} cột</p><ListStatsTable lists={data.rows} /></>;
  if (data.kind === 'LABELS') {
    return (
      <>
        <p className="text-xs">Tổng: {data.total} nhãn</p>
        <ul className="space-y-1 text-xs">
          {data.rows.map((l) => (
            <li key={l.id} className="flex items-center gap-2">
              <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
              <span className="min-w-0 flex-1 break-words">{l.name || 'Nhãn không tên'}</span>
              <span className="tabular-nums text-slate-500 dark:text-slate-400">{l.cards} thẻ</span>
            </li>
          ))}
        </ul>
      </>
    );
  }
  if (data.kind === 'CUSTOM_FIELDS') {
    return (
      <>
        <p className="text-xs">Tổng: {data.total} trường tùy chỉnh</p>
        <ul className="space-y-1.5 text-xs">
          {data.rows.map((f) => (
            <li key={f.id}>
              <span className="font-medium">{f.name}</span> <span className="text-slate-500 dark:text-slate-400">· {FIELD_TYPE[f.type] ?? f.type}</span>
              {f.options.length > 0 && <span className="block break-words text-slate-600 dark:text-slate-300">{f.options.map((o) => o.value).join(' · ')}</span>}
            </li>
          ))}
        </ul>
      </>
    );
  }
  return null;
}

// ===================== query_data (buoc B): truy van tong quat =====================
type DataBlockData = Extract<ChatV2Block, { tool: 'query_data' }>['data'];
const ENTITY_NOUN: Record<DataBlockData['entity'], string> = { CARD: 'công việc', COMMENT: 'bình luận', CHECKLIST_ITEM: 'mục checklist', ATTACHMENT: 'tệp' };
const BUCKET_NAME = { DAY: 'ngày', WEEK: 'tuần', MONTH: 'tháng' } as const;

function Cell({ column, value, generatedAt }: { column: ChatV2DataColumn; value: string | number | boolean | null; generatedAt: string }) {
  if (value === null || value === '') return <span className="text-slate-400">—</span>;
  if (column.type === 'status') return <StatusBadge status={value as CardStatus} />;
  if (column.type === 'bool') return <>{value ? 'Có' : 'Không'}</>;
  if (column.type === 'date') return <>{formatDateTime(String(value), generatedAt)}</>;
  if (column.type === 'number') return <span className="tabular-nums">{value}</span>;
  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
}

/**
 * Mot hang = tieu de (cot dau, co lien ket den the) + cac cot con lai dang "nhan: gia tri". Giu xep doc de vua panel hep; noi dung van ban la du
 * lieu do nguoi khac viet nen luon hien thanh chu thuan (React tu thoat ky tu), khong bao gio la lien ket hay chi dan.
 */
export function QueryDataBlock({ data, generatedAt }: { data: DataBlockData; generatedAt: string }) {
  if (data.mode === 'GROUPS') {
    const bucket = data.bucket ? ` theo ${BUCKET_NAME[data.bucket]}` : '';
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-medium">{data.matched} {ENTITY_NOUN[data.entity]} · {data.total} nhóm theo {data.groupLabel?.toLowerCase()}{bucket}</p>
        {data.highestCount > 0 && <p className="text-xs">Nhiều nhất{data.topGroups > 1 ? ` (đồng hạng ${data.topGroups} nhóm)` : ''}: {data.highestCount} {ENTITY_NOUN[data.entity]}/nhóm.</p>}
        {data.groups.length === 0 ? <p className="text-xs">Không có dữ liệu khớp điều kiện.</p> : (
          <table className="w-full text-xs">
            <thead><tr><th className="text-left">{data.groupLabel}</th><th className="text-right">Số {ENTITY_NOUN[data.entity]}</th></tr></thead>
            <tbody>
              {data.groups.map((g) => (
                <tr key={g.id ?? g.label} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="py-1 pr-2 break-words">{g.label}</td><td className="text-right tabular-nums">{g.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }
  const [head, ...rest] = data.columns;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">Tổng: {data.matched} {ENTITY_NOUN[data.entity]}</p>
      {data.rows.length === 0 && <p className="text-xs">Không có dữ liệu khớp điều kiện.</p>}
      <ul className="space-y-1.5">
        {data.rows.map((row) => {
          const title = head ? row.cells[head.key] : null;
          const link = row.cardId && row.boardId ? cardLink({ id: row.cardId, boardId: row.boardId }) : null;
          return (
            <li key={row.id} className={TILE}>
              {head && (
                <p className="text-sm">
                  {link && head.type === 'text' && title !== null
                    ? <Link to={link} onClick={(e) => e.currentTarget.blur()} className="whitespace-pre-wrap break-words font-medium text-primary-ink hover:underline">{String(title)}</Link>
                    : <Cell column={head} value={title} generatedAt={generatedAt} />}
                </p>
              )}
              {rest.length > 0 && (
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  {rest.map((c) => (<div key={c.key} className="contents"><dt className="text-slate-500 dark:text-slate-400">{c.label}</dt><dd><Cell column={c} value={row.cells[c.key]} generatedAt={generatedAt} /></dd></div>))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
