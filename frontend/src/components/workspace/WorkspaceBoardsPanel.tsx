import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { assetUrl } from '../../lib/assets';
import type { OverviewStatusFilter, WorkspaceOverview } from '../../lib/api/workspace';
import type { Board } from '../../types/board';
import type { WorkspaceMember } from '../../types/workspace';
import { SkeletonBoardGrid, SkeletonRegion, SkeletonRows } from '../Skeleton';
import { FOCUS, INPUT, PANEL, PRIMARY_BUTTON, SECONDARY_BUTTON } from './workspaceUi';
import { WorkspaceIcon } from './WorkspaceIcon';

const STATUS_OPTIONS: { value: OverviewStatusFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'overdue', label: 'Quá hạn' },
  { value: 'unassigned', label: 'Chưa giao' },
  { value: 'done', label: 'Đã hoàn thành' },
];
const VISIBILITY = {
  PRIVATE: { label: 'Riêng tư', icon: 'M6 10h12v10H6zM8 10V7a4 4 0 0 1 8 0v3' },
  WORKSPACE: { label: 'Không gian', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  PUBLIC: { label: 'Công khai', icon: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18' },
};

interface Props {
  boards: Board[];
  boardCount?: number;
  boardsLoading: boolean;
  boardsError: string | null;
  onReloadBoards: () => void;
  onCreate: () => void;
  overview: WorkspaceOverview | null;
  overviewLoading: boolean;
  overviewError: string | null;
  onReloadOverview: () => void;
  members: WorkspaceMember[];
  assigneeFilter: string;
  onAssigneeFilter: (id: string) => void;
  statusFilter: OverviewStatusFilter;
  onStatusFilter: (status: OverviewStatusFilter) => void;
}

function BoardTile({ board }: { board: Board }) {
  const count = board.cardCount;
  const done = board.doneCount ?? 0;
  const progress = typeof count === 'number' && count > 0 ? Math.min(100, Math.round(done / count * 100)) : 0;
  const visibility = VISIBILITY[board.visibility];
  return (
    <Link to={`/boards/${board.id}`} aria-label={`Mở bảng ${board.name}`} className={`group overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors hover:border-primary/50 dark:border-slate-700 dark:bg-slate-800 ${FOCUS}`}>
      <div className="flex h-20 items-end bg-cover bg-center p-3" style={board.backgroundImage ? { backgroundImage: `url(${assetUrl(board.backgroundImage)})` } : { backgroundColor: board.color }}>
        <span className="inline-flex items-center gap-1 rounded-md bg-black/40 px-1.5 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
          <WorkspaceIcon path={visibility.icon} className="h-3 w-3" />
          {visibility.label}
        </span>
      </div>
      <div className="p-3">
        <p title={board.name} className="truncate text-sm font-semibold text-slate-800 group-hover:text-primary-ink dark:text-slate-100">{board.name}</p>
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span>{typeof count === 'number' ? `${done}/${count} công việc hoàn thành` : 'Mở bảng để xem công việc'}</span>
          {typeof count === 'number' && count > 0 && <span className="font-medium text-emerald-600 dark:text-emerald-400">{progress}%</span>}
        </div>
        {typeof count === 'number' && count > 0 && <div role="progressbar" aria-label={`Tiến độ ${board.name}`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
        </div>}
      </div>
    </Link>
  );
}

export default function WorkspaceBoardsPanel(props: Props) {
  const tasksRef = useRef<HTMLElement>(null);
  const { overview, overviewLoading, overviewError, assigneeFilter, statusFilter, boards } = props;
  const stats = overview?.stats;
  const donePct = stats && stats.total > 0 ? Math.round(stats.done / stats.total * 100) : 0;
  const metrics = [
    { label: 'Tổng công việc', value: stats?.total, status: 'all' as const, color: 'text-slate-800 dark:text-slate-100', icon: 'M4 4h6v16H4zM14 4h6v10h-6z' },
    { label: 'Quá hạn', value: stats?.overdue, status: 'overdue' as const, color: 'text-rose-600 dark:text-rose-400', icon: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0' },
    { label: 'Chưa giao', value: stats?.unassigned, status: 'unassigned' as const, color: 'text-amber-600 dark:text-amber-400', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0' },
    { label: 'Đã hoàn thành', value: stats?.done, status: 'done' as const, color: 'text-emerald-600 dark:text-emerald-400', icon: 'm5 12 4 4L19 6' },
  ];
  return (
    <div className="space-y-6">
      <section aria-label="Tiến độ không gian" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Tiến độ công việc</h2>
          <button type="button" disabled={overviewLoading} onClick={props.onReloadOverview} className={SECONDARY_BUTTON}>
            <WorkspaceIcon path="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.55-2.6L20 7M4 17l2.35 2.6A7 7 0 0 0 17.9 17" />
            Làm mới
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Tổng hợp từ các bảng bạn có quyền xem. Chọn một chỉ số để lọc công việc bên dưới.</p>
        {overviewError && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{overviewError}</div>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {metrics.map((metric) => <button key={metric.status} type="button" aria-pressed={statusFilter === metric.status} onClick={() => { props.onStatusFilter(metric.status); tasksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className={`rounded-xl border p-4 text-left transition-colors ${FOCUS} ${statusFilter === metric.status ? 'border-primary/40 bg-primary-soft' : 'border-slate-200 bg-white hover:border-primary/30 dark:border-slate-700 dark:bg-slate-800'}`}>
            <span className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">{metric.label}<WorkspaceIcon path={metric.icon} className={`h-4 w-4 ${metric.color}`} /></span>
            <span className={`mt-2 block text-2xl font-semibold tabular-nums ${metric.color}`}>{overviewLoading || overviewError ? '—' : metric.value ?? '—'}</span>
          </button>)}
        </div>
        {stats && !overviewLoading && !overviewError && <div className="flex items-center gap-3 rounded-xl bg-slate-100/80 px-4 py-3 dark:bg-slate-800/60">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Hoàn thành</span>
          <div role="progressbar" aria-label="Tiến độ không gian" aria-valuenow={donePct} aria-valuemin={0} aria-valuemax={100} className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${donePct}%` }} /></div>
          <span className="text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{donePct}%</span>
        </div>}
      </section>

      <section aria-labelledby="workspace-boards-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="workspace-boards-heading" className="text-base font-semibold text-slate-800 dark:text-slate-100">Bảng trong không gian <span className="ml-1 text-sm font-normal text-slate-400">({boards.length})</span></h2>
          <button type="button" onClick={props.onCreate} className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-primary-ink hover:bg-primary-soft ${FOCUS}`}>+ Tạo bảng</button>
        </div>
        {typeof props.boardCount === 'number' && props.boardCount > boards.length && <p className="text-xs text-slate-500 dark:text-slate-400">Còn {props.boardCount - boards.length} bảng bạn không có quyền xem hoặc đã lưu trữ.</p>}
        {props.boardsError ? <div role="alert" className={PANEL}><p className="text-sm text-rose-600 dark:text-rose-400">{props.boardsError}</p><button type="button" onClick={props.onReloadBoards} className={`mt-2 rounded text-sm font-medium text-primary-ink ${FOCUS}`}>Tải lại bảng</button></div>
          : props.boardsLoading && boards.length === 0 ? <SkeletonRegion label="Đang tải bảng…"><SkeletonBoardGrid count={3} /></SkeletonRegion>
          : boards.length > 0 ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{boards.map((board) => <BoardTile key={board.id} board={board} />)}</div>
          : <div className={`${PANEL} text-center`}>
            <p className="font-medium text-slate-700 dark:text-slate-200">Chưa có bảng nào để mở</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Tạo bảng trong không gian này để bắt đầu sắp xếp công việc.</p>
            <button type="button" onClick={props.onCreate} className={`mt-4 ${PRIMARY_BUTTON}`}>Tạo bảng đầu tiên</button>
          </div>}
      </section>

      <section ref={tasksRef} aria-labelledby="workspace-tasks-heading" className={PANEL}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="workspace-tasks-heading" className="text-base font-semibold text-slate-800 dark:text-slate-100">Công việc cần theo dõi</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Bấm công việc để mở đúng thẻ trong bảng.</p></div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <select aria-label="Người phụ trách" value={assigneeFilter} onChange={(e) => props.onAssigneeFilter(e.target.value)} className={`max-w-full flex-1 sm:flex-none ${INPUT}`}>
              <option value="">Mọi người phụ trách</option>
              {props.members.map((member) => <option key={member.userId} value={member.userId}>{member.user.name}</option>)}
            </select>
            <select aria-label="Trạng thái công việc" value={statusFilter} onChange={(e) => props.onStatusFilter(e.target.value as OverviewStatusFilter)} className={`max-w-full ${INPUT}`}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>
        {assigneeFilter && <p className="mt-3 text-xs text-primary-ink">Các chỉ số và danh sách đang lọc theo người phụ trách đã chọn.</p>}
        {overviewLoading ? <SkeletonRegion label="Đang tải công việc…" className="mt-4"><SkeletonRows rows={3} /></SkeletonRegion>
          : overviewError ? <p className="mt-5 text-sm text-slate-500 dark:text-slate-400">Bấm Làm mới để tải lại công việc.</p>
          : !overview || overview.cards.length === 0 ? <p role="status" className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{statusFilter === 'all' && !assigneeFilter ? 'Chưa có công việc trong các bảng bạn có quyền xem.' : 'Không có công việc nào khớp bộ lọc.'}</p>
          : <ul className="tf-scroll mt-4 max-h-[420px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-700">
            {overview.cards.map((card) => <li key={card.id}>
              <Link to={`/boards/${card.list.boardId}?card=${encodeURIComponent(card.id)}`} className={`flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50 ${FOCUS}`}>
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${card.isDone ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400' : 'border-2 border-slate-200 dark:border-slate-600'}`}>{card.isDone && <WorkspaceIcon path="m5 12 4 4L19 6" className="h-3 w-3" />}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium ${card.isDone ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100'}`}>{card.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{card.list.board.name} · {card.list.name}{card.dueDate && ` · Hạn ${new Date(card.dueDate).toLocaleDateString('vi-VN')}`}{card.members.length > 0 ? ` · ${card.members.map((member) => member.user.name).join(', ')}` : ' · Chưa giao'}</span>
                </span>
                <WorkspaceIcon path="m9 5 7 7-7 7" className="mt-1 h-3.5 w-3.5 text-slate-400" />
              </Link>
            </li>)}
          </ul>}
        {overview && overview.cards.length === 200 && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Đang hiển thị tối đa 200 công việc. Dùng bộ lọc để thu hẹp danh sách.</p>}
      </section>
    </div>
  );
}
