import { NavLink } from 'react-router-dom';
import { useBoards } from '../context/BoardsContext';
import { useWorkspaces } from '../context/WorkspacesContext';
import { NAV_ITEMS, boardSwatchStyle, useWorkspaceOpenState } from '../lib/sidebarNav';
import NavDrawer from './nav/NavDrawer';

const ACTIVE =
  'flex items-center gap-3 rounded px-3 py-2 text-sm bg-primary-soft font-semibold text-primary-ink';
const INACTIVE =
  'flex items-center gap-3 rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700';

function NavIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

// Nội dung điều hướng: dùng chung cho sidebar desktop và ngăn điều hướng trên điện thoại
export function SidebarContent() {
  const { boards } = useBoards();
  const { workspaces, currentWorkspaceId, setCurrentWorkspaceId } = useWorkspaces();
  const starred = boards.filter((b) => b.isStarred);
  const { isOpen, setOpen } = useWorkspaceOpenState(currentWorkspaceId);

  return (
    <>
      <nav aria-label="Điều hướng chính" className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? ACTIVE : INACTIVE)}
          >
            <span className="text-slate-500 dark:text-slate-400">
              <NavIcon path={item.icon} />
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="my-2 border-t border-slate-200 dark:border-slate-700" />

      {starred.length > 0 && (
        <div className="mb-2">
          <p className="flex items-center gap-1 px-3 pb-1 text-xs font-semibold text-slate-500">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-amber-400" fill="currentColor" aria-hidden="true">
              <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
            </svg>
            Yêu thích
          </p>
          {starred.map((b) => (
            <NavLink
              key={b.id}
              to={`/boards/${b.id}`}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded px-3 py-2 text-sm dark:text-slate-200 ${
                  isActive
                    ? 'bg-primary-soft font-semibold text-primary-ink'
                    : 'text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`
              }
            >
              <span className="h-4 w-5 shrink-0 rounded-[3px]" style={boardSwatchStyle(b)} />
              <span className="truncate">{b.name}</span>
            </NavLink>
          ))}
        </div>
      )}

      <p className="px-3 pb-1 pt-1 text-xs font-semibold text-slate-500">Các Không gian làm việc</p>

      <div className="flex flex-col gap-1">
        {workspaces.map((w) => {
          const wsBoards = boards.filter((b) => b.workspaceId === w.id);
          const isCurrent = w.id === currentWorkspaceId;
          const open = isOpen(w.id);
          const panelId = `sidebar-ws-${w.id}`;
          return (
            <div key={w.id}>
              <div
                className={`flex items-center rounded ${
                  isCurrent
                    ? 'bg-primary-soft font-semibold text-primary-ink'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setCurrentWorkspaceId(w.id);
                    setOpen(w.id, true);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded px-3 py-2 text-sm"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-gradient-to-br from-[var(--brand-accent)] to-primary text-xs font-bold text-white">
                    {w.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-1 truncate text-left font-medium">{w.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(w.id, !open)}
                  aria-expanded={open}
                  aria-controls={panelId}
                  aria-label={`${open ? 'Thu gọn' : 'Mở rộng'} ${w.name}`}
                  className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/10"
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </div>

              {/* Đóng/mở mượt bằng chiều cao dòng lưới; phần đóng dùng inert để không nhận focus */}
              <div id={panelId} className="tf-collapse" data-open={open}>
                <div inert={!open}>
                  <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-slate-200 pl-2 dark:border-slate-700">
                    {wsBoards.map((b) => (
                      <NavLink
                        key={b.id}
                        to={`/boards/${b.id}`}
                        className={({ isActive }) =>
                          `flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
                            isActive
                              ? 'bg-primary-soft font-semibold text-primary-ink'
                              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
                          }`
                        }
                      >
                        <span className="h-4 w-5 shrink-0 rounded-[3px]" style={boardSwatchStyle(b)} />
                        <span className="truncate">{b.name}</span>
                      </NavLink>
                    ))}
                    <NavLink
                      to={`/workspaces/${w.id}`}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.14.31.22.65.22 1z" />
                      </svg>
                      Quản lý không gian
                    </NavLink>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-2 md:block dark:border-slate-700 dark:bg-slate-800">
      <SidebarContent />
    </aside>
  );
}

// Ngăn điều hướng cho điện thoại (dưới 768px)
export function MainMobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <NavDrawer open={open} onClose={onClose} label="Điều hướng">
      <SidebarContent />
    </NavDrawer>
  );
}
