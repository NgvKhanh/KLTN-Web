import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBoards } from '../context/BoardsContext';
import { useTheme } from '../context/ThemeContext';
import { useWorkspaces } from '../context/WorkspacesContext';
import { assetUrl } from '../lib/assets';
import { searchCards, type SearchCard } from '../lib/api/card';
import { createWorkspace } from '../lib/api/workspace';
import { getErrorMessage } from '../lib/errorMessage';
import type { Board } from '../types/board';
import AssistantButton from './assistant/AssistantButton';
import Avatar from './Avatar';
import { AiGenerateBoardModal, CreateBoardDialog } from './board/lazy';
import { ModalLoading } from './PageLoading';
import Logo from './Logo';
import NotificationBell from './NotificationBell';

// ------- Chuyen doi khong gian lam viec -------
function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const { workspaces, currentWorkspace, currentWorkspaceId, setCurrentWorkspaceId, upsertWorkspace } =
    useWorkspaces();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ws = await createWorkspace(name);
      upsertWorkspace({ ...ws, myRole: 'OWNER', memberCount: 1, boardCount: 0 });
      setCurrentWorkspaceId(ws.id);
      setNewName('');
      setCreating(false);
      setOpen(false);
      navigate(`/workspaces/${ws.id}`);
    } catch (err) {
      setError(getErrorMessage(err, 'Không tạo được không gian.'));
    } finally {
      setBusy(false);
    }
  }

  const item =
    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700';

  return (
    <div ref={ref} className="relative hidden shrink-0 sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[11rem] items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 8a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 8a3 3 0 100-6M15 20a6 6 0 019-5" />
        </svg>
        <span className="truncate">
          {currentWorkspace?.name ?? 'Không gian'}
        </span>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="tf-menu-in absolute left-0 top-11 z-40 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
          <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Không gian làm việc
          </p>
          <div className="max-h-64 overflow-y-auto">
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  setCurrentWorkspaceId(w.id);
                  setOpen(false);
                }}
                className={item + ' justify-between'}
              >
                <span className="min-w-0 flex-1 truncate">
                  {w.name}
                  {w.isPersonal && (
                    <span className="text-slate-400"> · cá nhân</span>
                  )}
                </span>
                {w.id === currentWorkspaceId && (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-primary-ink" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          <div className="my-1 border-t border-slate-200 dark:border-slate-700" />

          {currentWorkspaceId && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(`/workspaces/${currentWorkspaceId}`);
              }}
              className={item}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19 12a7 7 0 00-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 00-1.7-1L14 2h-4l-.8 2.5a7 7 0 00-1.7 1l-2.4-1-2 3.5L3 10a7 7 0 000 4l-2 1.5 2 3.5 2.4-1a7 7 0 001.7 1L10 22h4l.8-2.5a7 7 0 001.7-1l2.4 1 2-3.5-2-1.5a7 7 0 00.1-1z" />
              </svg>
              Quản lý không gian này
            </button>
          )}

          {creating ? (
            <form onSubmit={submitCreate} className="p-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Tên không gian mới"
                className="mb-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-800"
              />
              {error && <p className="mb-1 text-xs text-red-600">{error}</p>}
              <div className="flex gap-1.5">
                <button
                  type="submit"
                  disabled={busy || !newName.trim()}
                  className="flex-1 rounded-lg bg-primary px-2 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                >
                  {busy ? '...' : 'Tạo'}
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Huỷ
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className={item + ' font-medium text-primary-ink'}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Tạo không gian mới
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Thumb({ board }: { board: Board }) {
  const style = board.backgroundImage
    ? {
        backgroundImage: `url(${assetUrl(board.backgroundImage)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { backgroundColor: board.color };
  return <span className="h-8 w-11 shrink-0 rounded-md" style={style} />;
}

// ------- Tim kiem bang (dropdown kieu Trello) -------
function BoardSearch() {
  const { boards } = useBoards();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const term = q.trim().toLowerCase();
  const allMatches = useMemo(
    () => (term ? boards.filter((b) => b.name.toLowerCase().includes(term)) : []),
    [term, boards]
  );
  const matches = allMatches.slice(0, 5);

  // Tim the xuyen board (debounce, chi goi API khi ngung go 300ms)
  const [cardResults, setCardResults] = useState<SearchCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  useEffect(() => {
    const raw = q.trim();
    if (!raw) {
      setCardResults([]);
      setCardsLoading(false);
      return;
    }
    setCardsLoading(true);
    const timer = setTimeout(() => {
      searchCards(raw)
        .then(setCardResults)
        .catch(() => setCardResults([]))
        .finally(() => setCardsLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  function goToCard(card: SearchCard) {
    navigate(`/boards/${card.list.boardId}?card=${card.id}`);
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
  }

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    // Phím "/" -> nhảy vào ô tìm kiếm (khi không gõ ở chỗ khác)
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      )
        return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  function go(id: string) {
    navigate(`/boards/${id}`);
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function seeAll() {
    navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search');
    setQ('');
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1 sm:max-w-md">
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={q}
        aria-label="Tìm kiếm bảng"
        placeholder="Tìm kiếm bảng..."
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Enter' && matches[0]) go(matches[0].id);
        }}
        className="h-9 w-full rounded-lg border border-transparent bg-slate-100 pl-9 pr-9 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/25 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-slate-800"
      />
      {q ? (
        <button
          type="button"
          onClick={() => {
            setQ('');
            inputRef.current?.focus();
          }}
          aria-label="Xoá"
          className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-slate-300 bg-white px-1.5 text-[11px] font-medium text-slate-400 sm:block dark:border-slate-600 dark:bg-slate-900">
          /
        </kbd>
      )}

      {open && term && (
        <div className="absolute left-0 right-0 top-11 z-40 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
          <div className="border-b border-slate-200 px-3 dark:border-slate-700">
            <span className="inline-block border-b-2 border-primary py-2 text-sm font-medium text-primary-ink">
              Bảng
            </span>
          </div>

          <div className="py-2">
            <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">
              BẢNG
            </p>

            {matches.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-400">
                Không tìm thấy bảng nào khớp "{q.trim()}".
              </p>
            ) : (
              matches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => go(b.id)}
                  className="flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  <Thumb board={b} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-900 dark:text-slate-100">
                      {b.name}
                    </span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {b.workspaceName ?? 'Không gian làm việc'}
                    </span>
                  </span>
                </button>
              ))
            )}
            <button
              type="button"
              onClick={seeAll}
              className="px-3 py-2 text-sm font-medium text-primary-ink hover:underline"
            >
              Tìm nâng cao "{q.trim()}"...
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto border-t border-slate-200 py-2 dark:border-slate-700">
            <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">
              THẺ
            </p>
            {cardsLoading ? (
              <p className="px-3 py-2 text-sm text-slate-400">Đang tìm...</p>
            ) : cardResults.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-400">
                Không tìm thấy thẻ nào khớp "{q.trim()}".
              </p>
            ) : (
              cardResults.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => goToCard(c)}
                  className="flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  <span
                    className="h-8 w-8 shrink-0 rounded-md"
                    style={{ backgroundColor: c.coverColor ?? c.list.board.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-900 dark:text-slate-100">
                      {c.title}
                    </span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {c.list.board.name} · {c.list.name}
                      {c.dueDate &&
                        ` · Hạn ${new Date(c.dueDate).toLocaleDateString('vi-VN')}`}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          <button
            type="button"
            disabled={!matches[0]}
            onClick={() => matches[0] && go(matches[0].id)}
            className="flex w-full items-center gap-2 border-t border-slate-200 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <span className="flex-1 truncate">
              {matches[0] ? `Mở "${matches[0].name}"` : 'Tìm kiếm'}
            </span>
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-900">
              ⏎
            </kbd>
          </button>
        </div>
      )}
    </div>
  );
}

// ------- Tao bang moi -------
// label: nhãn luôn hiện (dùng ở trang tổng quan); bỏ trống -> "Tạo mới" và ẩn nhãn trên màn hình hẹp
export function CreateBoardMenu({ label }: { label?: string } = {}) {
  const navigate = useNavigate();
  const { upsertBoard } = useBoards();
  const [open, setOpen] = useState(false);
  // Modal AI: trang thai nam o CHA, khong nam trong popover. Bam "Tao bang bang AI" thi popover dong va
  // modal mo ra nhu ANH EM: popover tu dong khi bam ra ngoai vung cua no, con modal (portal) nam ngoai vung do.
  const [aiOpen, setAiOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <>
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover hover:shadow sm:px-3"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className={label ? '' : 'hidden sm:inline'}>{label ?? 'Tạo mới'}</span>
      </button>

      {open && (
        <Suspense fallback={null}>
          <CreateBoardDialog
            className="tf-menu-in absolute right-0 top-11 z-40"
            onClose={() => setOpen(false)}
            onOpenAi={() => {
              setOpen(false);
              setAiOpen(true);
            }}
            onCreated={(board) => {
              upsertBoard(board);
              setOpen(false);
              navigate(`/boards/${board.id}`);
            }}
          />
        </Suspense>
      )}
    </div>
    {aiOpen && (
      <Suspense fallback={<ModalLoading />}>
        <AiGenerateBoardModal
          onClose={() => setAiOpen(false)}
          onCreated={(board) => {
            upsertBoard(board);
            setAiOpen(false);
            navigate(`/boards/${board.id}`);
          }}
        />
      </Suspense>
    )}
    </>
  );
}

// ------- Menu tai khoan -------
// Hai nhóm mục: việc của tôi / cài đặt tài khoản. Biểu tượng của mục trùng với sidebar dùng cùng nét vẽ.
const ACCOUNT_GROUPS = [
  [
    { to: '/my-cards', label: 'Thẻ của tôi', icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11' },
    { to: '/calendar', label: 'Lịch', icon: 'M5 4h14a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM3 10h18M8 2v4M16 2v4' },
    { to: '/activity', label: 'Hoạt động của tôi', icon: 'M22 12h-4l-3 9L9 3l-3 9H2' },
  ],
  [
    { to: '/settings/profile', label: 'Hồ sơ', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0' },
    { to: '/settings/notifications', label: 'Cài đặt thông báo', icon: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0' },
    { to: '/settings/password', label: 'Đổi mật khẩu', icon: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4' },
  ],
] as const;

const THEME_OPTIONS = [
  { value: 'light', label: 'Sáng', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' },
  { value: 'dark', label: 'Tối', icon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z' },
  { value: 'system', label: 'Hệ thống', icon: 'M3 4h18v12H3zM8 20h8M12 16v4' },
] as const;

function MenuIcon({ path, className = 'h-4 w-4' }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

// Màu chữ của từng loại mục để riêng, không ghép chuỗi đè lên nhau (trước đây "Đăng xuất" ghép
// text-red-600 vào sau text-slate-700 nên vẫn ra màu xám: Tailwind không ưu tiên lớp viết sau).
const MENU_ITEM = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors';
const MENU_ITEM_IDLE = 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/70';
const MENU_ITEM_ACTIVE = 'bg-primary-soft font-medium text-primary-ink';

export function AccountMenu() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    // Esc đóng menu và trả con trỏ bàn phím về nút ảnh đại diện
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function handleLogout() {
    setOpen(false);
    try {
      await logout();
    } catch {
      // logout() đã xoá phiên ở máy này trong finally; lỗi mạng không được giữ người dùng lại
    }
    navigate('/', { replace: true });
  }

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={user?.name}
        aria-label="Tài khoản"
        aria-haspopup="true"
        aria-expanded={open}
        className={`grid shrink-0 place-items-center rounded-full ring-2 transition focus-visible:outline-none focus-visible:ring-primary ${
          open ? 'ring-primary/40' : 'ring-transparent hover:ring-slate-200 dark:hover:ring-slate-700'
        }`}
      >
        <Avatar
          id={user?.id ?? 'me'}
          name={user?.name ?? '?'}
          avatarUrl={user?.avatarUrl}
          className="h-8 w-8 text-xs"
        />
      </button>

      {open && (
        <div className="tf-menu-in absolute right-0 top-11 z-40 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
          <div className="flex items-center gap-3 px-4 pb-3 pt-4">
            <Avatar
              id={user?.id ?? 'me'}
              name={user?.name ?? '?'}
              avatarUrl={user?.avatarUrl}
              className="h-10 w-10 text-sm"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user?.name}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
            </div>
          </div>

          {ACCOUNT_GROUPS.map((group, i) => (
            <div key={i} className="border-t border-slate-100 p-1.5 dark:border-slate-700">
              {group.map((it) => {
                const active = pathname === it.to || pathname.startsWith(it.to + '/');
                return (
                  <button
                    key={it.to}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => go(it.to)}
                    className={`${MENU_ITEM} ${active ? MENU_ITEM_ACTIVE : MENU_ITEM_IDLE}`}
                  >
                    <MenuIcon
                      path={it.icon}
                      className={`h-4 w-4 ${active ? '' : 'text-slate-400 dark:text-slate-500'}`}
                    />
                    {it.label}
                  </button>
                );
              })}
            </div>
          ))}

          <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-700">
            <p id="account-theme-label" className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              Giao diện
            </p>
            <div
              role="radiogroup"
              aria-labelledby="account-theme-label"
              className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900/60"
            >
              {THEME_OPTIONS.map((o) => {
                const checked = theme === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => setTheme(o.value)}
                    className={`flex items-center justify-center gap-1 rounded-md px-1 py-1.5 text-xs font-medium transition ${
                      checked
                        ? 'bg-white text-primary-ink shadow-sm dark:bg-slate-700'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    <MenuIcon path={o.icon} className="h-3.5 w-3.5" />
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-100 p-1.5 dark:border-slate-700">
            <button
              type="button"
              onClick={handleLogout}
              className={`${MENU_ITEM} font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10`}
            >
              <MenuIcon path="M9 21H6a2 2 0 01-2-2V5a2 2 0 012-2h3M16 17l5-5-5-5M21 12H9" />
              Đăng xuất
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// onOpenNav: có thì hiện nút mở ngăn điều hướng (chỉ ở màn hình dưới 768px, nơi sidebar bị ẩn)
export default function Header({ onOpenNav }: { onOpenNav?: () => void } = {}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 sm:gap-4 sm:px-4 dark:border-slate-700 dark:bg-slate-900">
      {onOpenNav && (
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Mở điều hướng"
          aria-haspopup="dialog"
          className="-ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}
      <Link
        to="/boards"
        className="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <Logo
          markClassName="h-7 w-7"
          textClassName="hidden text-lg font-extrabold tracking-tight text-slate-800 sm:block dark:text-white"
        />
      </Link>

      <WorkspaceSwitcher />

      <BoardSearch />

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <CreateBoardMenu />
        <AssistantButton />
        <NotificationBell />
        <AccountMenu />
      </div>
    </header>
  );
}
