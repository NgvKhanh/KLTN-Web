import { Suspense, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { useBoards } from '../context/BoardsContext';
import { useWorkspaces } from '../context/WorkspacesContext';
import { NAV_ITEMS, boardSwatchStyle, useWorkspaceOpenState } from '../lib/sidebarNav';
import type { Board } from '../types/board';
import { CreateBoardDialog } from './board/lazy';
import { ModalLoading } from './PageLoading';
import NavDrawer from './nav/NavDrawer';

const COLLAPSED_KEY = 'taskflow_board_sidebar_collapsed';
// Khóa đóng/mở của nhóm "bảng được chia sẻ" (bảng thuộc không gian mà mình không phải thành viên)
const SHARED_KEY = 'shared';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary';
const ROW_ACTIVE = 'bg-primary-soft font-semibold text-primary-ink';
const ROW_IDLE = 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700';
const BOARD_IDLE = 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700';
const ICON_BUTTON = `grid shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200 ${FOCUS}`;

const PATH = {
  chevron: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3',
  close: 'M6 6l12 12M18 6L6 18',
  shrink: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
  expand: 'M13 17l5-5-5-5M6 17l5-5-5-5',
  people: 'M9 8a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 8a3 3 0 100-6M15 20a6 6 0 019-5',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.14.31.22.65.22 1z',
};

function Icon({ path, className = 'h-4 w-4' }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} shrink-0`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-amber-400" fill="currentColor">
      <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
    </svg>
  );
}

function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLocaleLowerCase('vi').trim();
}

function BoardRow({ board, showStar = true }: { board: Board; showStar?: boolean }) {
  return (
    <NavLink
      to={`/boards/${board.id}`}
      title={board.name}
      className={({ isActive }) =>
        `flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-sm ${FOCUS} ${isActive ? ROW_ACTIVE : BOARD_IDLE}`
      }
    >
      <span aria-hidden="true" className="h-4 w-5 shrink-0 rounded-[3px]" style={boardSwatchStyle(board)} />
      <span className="min-w-0 flex-1 truncate">{board.name}</span>
      {showStar && board.isStarred && <StarIcon />}
    </NavLink>
  );
}

interface GroupProps {
  name: string;
  letter?: string;
  current: boolean;
  open: boolean;
  onToggle: () => void;
  boards: Board[];
  // Có đường dẫn thì cuối nhóm có dòng "Quản lý không gian"
  manageTo?: string;
}

// Một không gian làm việc và các bảng của nó, đóng/mở được
function WorkspaceGroup({ name, letter, current, open, onToggle, boards, manageTo }: GroupProps) {
  const panelId = useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={`flex w-full min-w-0 items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 ${FOCUS} ${
          current ? 'font-semibold text-slate-900 dark:text-slate-50' : 'font-medium text-slate-700 dark:text-slate-200'
        }`}
      >
        <span
          aria-hidden="true"
          className={`grid h-6 w-6 shrink-0 place-items-center rounded text-xs font-bold ${
            current ? 'bg-primary text-white' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
          }`}
        >
          {letter ? letter : <Icon path={PATH.people} className="h-3.5 w-3.5" />}
        </span>
        <span title={name} className="min-w-0 flex-1 truncate">{name}</span>
        <Icon path={PATH.chevron} className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>

      {/* Đóng/mở mượt bằng chiều cao dòng lưới; phần đóng dùng inert để không nhận focus */}
      <div id={panelId} role="group" aria-label={name} className="tf-collapse" data-open={open}>
        <div inert={!open}>
          <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-slate-200 pl-2 dark:border-slate-700">
            {boards.map((board) => <BoardRow key={board.id} board={board} />)}
            {manageTo && (
              <NavLink
                to={manageTo}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded px-2 py-1.5 text-xs font-medium ${FOCUS} ${isActive ? ROW_ACTIVE : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'}`
                }
              >
                <Icon path={PATH.gear} className="h-3.5 w-3.5" />
                Quản lý không gian
              </NavLink>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Hộp tạo bảng mở giữa màn hình (không dùng popover bám vào nút vì sidebar hẹp, có vùng cuộn và ngăn kéo điện thoại sẽ cắt mất).
// Phím và lượt bấm bên trong không được lọt lên ngăn điều hướng điện thoại.
function CreateBoardModal({ workspaceId, onClose, onCreated }: {
  workspaceId?: string;
  onClose: () => void;
  onCreated: (board: Board) => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div role="dialog" aria-label="Tạo bảng mới" className="max-h-full overflow-y-auto rounded-xl">
        <Suspense fallback={<ModalLoading />}>
          <CreateBoardDialog workspaceId={workspaceId} onClose={onClose} onCreated={onCreated} className="tf-menu-in" />
        </Suspense>
      </div>
    </div>,
    document.body
  );
}

interface ContentProps {
  // true: dải hẹp chỉ có biểu tượng (chỉ dùng cho sidebar desktop)
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  // Gọi sau khi tạo bảng xong và đã chuyển trang (ngăn điều hướng điện thoại dùng để tự đóng)
  onNavigate?: () => void;
}

// Dùng chung cho sidebar desktop và ngăn điều hướng điện thoại
function BoardSidebarContent({ collapsed = false, onToggleCollapsed, onNavigate }: ContentProps) {
  const { boards, isLoading, error, reload, upsertBoard } = useBoards();
  const { workspaces, isLoading: workspacesLoading, currentWorkspaceId } = useWorkspaces();
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const searchId = useId();

  // Không gian của bảng đang mở (không phải không gian đang chọn chung trên toàn ứng dụng)
  const activeBoard = boards.find((board) => board.id === boardId);
  const activeWorkspaceId = activeBoard?.workspaceId ?? currentWorkspaceId;
  const knownWorkspaceIds = new Set(workspaces.map((ws) => ws.id));
  const activeIsShared = activeBoard !== undefined && !knownWorkspaceIds.has(activeBoard.workspaceId);
  const activeGroupKey = activeIsShared ? SHARED_KEY : activeWorkspaceId;
  const { isOpen, setOpen } = useWorkspaceOpenState(activeGroupKey);

  // Vào một bảng thì nhóm chứa nó luôn mở, để thấy mình đang ở đâu
  const activeBoardId = activeBoard?.id;
  useEffect(() => {
    if (activeBoardId && activeGroupKey) setOpen(activeGroupKey, true);
  }, [activeBoardId, activeGroupKey, setOpen]);

  const search = normalizeSearch(query);
  const matches = search ? boards.filter((board) => normalizeSearch(board.name).includes(search)) : boards;
  const starred = matches.filter((board) => board.isStarred);
  const groups = workspaces
    .map((ws) => ({ ws, boards: matches.filter((board) => board.workspaceId === ws.id) }))
    .filter((group) => !search || group.boards.length > 0);
  // Bảng được mời thẳng vào, thuộc không gian mà mình không phải thành viên: không có trong danh sách không gian
  const shared = workspacesLoading ? [] : matches.filter((board) => !knownWorkspaceIds.has(board.workspaceId));
  const loading = (isLoading && boards.length === 0) || (workspacesLoading && workspaces.length === 0);
  // Chỉ khóa không gian khi mình thật sự là thành viên; nếu không, hộp tạo bảng tự cho chọn
  const createWorkspaceId = activeWorkspaceId && knownWorkspaceIds.has(activeWorkspaceId) ? activeWorkspaceId : undefined;

  function closeSearch() {
    setQuery('');
    setSearching(false);
  }

  function onCreated(board: Board) {
    upsertBoard(board);
    setCreating(false);
    navigate(`/boards/${board.id}`);
    onNavigate?.();
  }

  const createModal = creating && (
    <CreateBoardModal workspaceId={createWorkspaceId} onClose={() => setCreating(false)} onCreated={onCreated} />
  );

  const collapseButton = onToggleCollapsed && (
    collapsed ? (
      <button type="button" onClick={onToggleCollapsed} aria-label="Mở rộng thanh bên" title="Mở rộng thanh bên" className={`${ICON_BUTTON} h-9 w-9`}>
        <Icon path={PATH.expand} />
      </button>
    ) : (
      <button type="button" onClick={onToggleCollapsed} className={`flex w-full items-center gap-3 rounded px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200 ${FOCUS}`}>
        <Icon path={PATH.shrink} />
        Thu gọn
      </button>
    )
  );

  if (collapsed) {
    // Dải hẹp: điều hướng chính + bảng yêu thích và bảng của không gian đang mở
    const railBoards = boards.filter((board) => board.isStarred || board.workspaceId === activeWorkspaceId);
    return (
      <>
        <div className="flex h-full min-h-0 flex-col items-center">
          <nav aria-label="Điều hướng chính" className="flex shrink-0 flex-col items-center gap-0.5 p-2">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={item.label}
                aria-label={item.label}
                className={({ isActive }) =>
                  `grid h-9 w-9 place-items-center rounded ${FOCUS} ${isActive ? ROW_ACTIVE : `${ROW_IDLE} text-slate-500 dark:text-slate-400`}`
                }
              >
                <Icon path={item.icon} />
              </NavLink>
            ))}
          </nav>
          <div className="my-1 w-8 shrink-0 border-t border-slate-200 dark:border-slate-700" />
          <nav aria-label="Bảng" className="tf-scroll flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto py-1">
            {railBoards.map((board) => (
              <NavLink
                key={board.id}
                to={`/boards/${board.id}`}
                title={board.name}
                aria-label={board.name}
                className={({ isActive }) =>
                  `grid h-9 w-9 shrink-0 place-items-center rounded ${FOCUS} ${isActive ? 'bg-primary-soft' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`
                }
              >
                <span aria-hidden="true" className="h-4 w-5 rounded-[3px]" style={boardSwatchStyle(board)} />
              </NavLink>
            ))}
            <button type="button" onClick={() => setCreating(true)} aria-label="Tạo bảng mới" title="Tạo bảng mới" className={`${ICON_BUTTON} h-9 w-9`}>
              <Icon path={PATH.plus} />
            </button>
          </nav>
          <div className="shrink-0 border-t border-slate-200 p-2 dark:border-slate-700">{collapseButton}</div>
        </div>
        {createModal}
      </>
    );
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <nav aria-label="Điều hướng chính" className="flex shrink-0 flex-col gap-0.5 p-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded px-3 py-2 text-sm ${FOCUS} ${isActive ? ROW_ACTIVE : ROW_IDLE}`
              }
            >
              <span className="text-slate-500 dark:text-slate-400"><Icon path={item.icon} /></span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mx-3 shrink-0 border-t border-slate-200 dark:border-slate-700" />

        <div className="flex shrink-0 items-center gap-1 px-3 pb-1 pt-3">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">Bảng của bạn</span>
          <button
            type="button"
            aria-label="Tìm bảng"
            aria-pressed={searching}
            title="Tìm bảng"
            onClick={() => (searching ? closeSearch() : setSearching(true))}
            className={`${ICON_BUTTON} h-7 w-7 ${searching ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
          >
            <Icon path={PATH.search} className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Tạo bảng mới" title="Tạo bảng mới" onClick={() => setCreating(true)} className={`${ICON_BUTTON} h-7 w-7`}>
            <Icon path={PATH.plus} className="h-3.5 w-3.5" />
          </button>
        </div>

        {searching && (
          <div className="shrink-0 px-2 pb-1">
            <label htmlFor={searchId} className="sr-only">Tìm bảng</label>
            <div className="flex items-center rounded border border-slate-300 bg-white px-2 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary dark:border-slate-600 dark:bg-slate-900">
              <input
                id={searchId}
                autoFocus
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    closeSearch();
                  }
                }}
                placeholder="Tìm bảng…"
                className="h-8 min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Xóa tìm kiếm" className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
                  <Icon path={PATH.close} className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {loading ? (
            <p role="status" className="px-2 py-3 text-sm text-slate-500 dark:text-slate-400">Đang tải các bảng…</p>
          ) : error ? (
            <div role="alert" className="mx-1 my-2 rounded border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <p>{error}</p>
              <button type="button" onClick={() => void reload()} className={`mt-1.5 rounded font-semibold underline underline-offset-2 ${FOCUS}`}>Thử lại</button>
            </div>
          ) : matches.length === 0 && (search || boards.length === 0) ? (
            <p role="status" className="px-2 py-3 text-sm text-slate-500 dark:text-slate-400">
              {search ? 'Không tìm thấy bảng nào.' : 'Chưa có bảng nào.'}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {starred.length > 0 && (
                <section aria-label="Yêu thích" className="mb-1">
                  <p className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <StarIcon />
                    Yêu thích
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {starred.map((board) => <BoardRow key={board.id} board={board} showStar={false} />)}
                  </div>
                </section>
              )}

              {groups.map(({ ws, boards: wsBoards }) => (
                <WorkspaceGroup
                  key={ws.id}
                  name={ws.name}
                  letter={ws.name.slice(0, 1).toLocaleUpperCase('vi')}
                  current={ws.id === activeWorkspaceId}
                  open={Boolean(search) || isOpen(ws.id)}
                  onToggle={() => !search && setOpen(ws.id, !isOpen(ws.id))}
                  boards={wsBoards}
                  manageTo={`/workspaces/${ws.id}`}
                />
              ))}

              {shared.length > 0 && (
                <WorkspaceGroup
                  name="Được chia sẻ với bạn"
                  current={activeIsShared}
                  open={Boolean(search) || isOpen(SHARED_KEY)}
                  onToggle={() => !search && setOpen(SHARED_KEY, !isOpen(SHARED_KEY))}
                  boards={shared}
                />
              )}
            </div>
          )}
        </div>

        {collapseButton && <div className="shrink-0 border-t border-slate-200 p-2 dark:border-slate-700">{collapseButton}</div>}
      </div>
      {createModal}
    </>
  );
}

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export default function BoardSidebar() {
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // trình duyệt chặn lưu trữ: chỉ mất khả năng nhớ giữa các lần mở
    }
  }

  return (
    <aside
      aria-label="Điều hướng bảng"
      className={`hidden shrink-0 flex-col border-r border-slate-200 bg-white md:flex dark:border-slate-700 dark:bg-slate-800 ${collapsed ? 'w-14' : 'w-64'}`}
    >
      <BoardSidebarContent collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
    </aside>
  );
}

export function BoardMobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <NavDrawer open={open} onClose={onClose} label="Điều hướng">
      <BoardSidebarContent onNavigate={onClose} />
    </NavDrawer>
  );
}
