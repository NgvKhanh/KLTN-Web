import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { createBoard } from '../../lib/api/board';
import {
  trackUnsplashDownload,
  type UnsplashPhoto,
} from '../../lib/api/unsplash';
import { useWorkspaces } from '../../context/WorkspacesContext';
import { BOARD_COLORS } from '../../lib/boardColors';
import { getErrorMessage } from '../../lib/errorMessage';
import { useUnsplashPhotos } from '../../lib/useUnsplashPhotos';
import type { Board } from '../../types/board';
import { Skeleton, SkeletonRegion } from '../Skeleton';

type Background =
  | { type: 'color'; value: string }
  | {
      type: 'image';
      url: string;
      thumb: string;
      downloadLocation: string;
      creditName: string;
      creditUrl: string;
    };

const DEFAULT_BG: Background = { type: 'color', value: BOARD_COLORS[0]! };

function bgToImage(p: UnsplashPhoto): Background {
  return {
    type: 'image',
    url: p.fullUrl,
    thumb: p.thumbUrl,
    downloadLocation: p.downloadLocation,
    creditName: p.attributionName,
    creditUrl: p.attributionUrl,
  };
}

// Xem truoc: khung bang nho + 3 cot mo phong (giong Trello)
function Preview({ bg }: { bg: Background }) {
  const style =
    bg.type === 'image'
      ? { backgroundImage: `url(${bg.thumb})` }
      : { backgroundColor: bg.value };
  return (
    <div
      className="mb-3 flex h-24 items-start justify-center gap-1.5 rounded-lg bg-cover bg-center p-3 shadow-inner"
      style={style}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-full w-1/3 rounded-md bg-white/85 shadow-sm"
          style={{ height: `${70 - i * 12}%` }}
        />
      ))}
    </div>
  );
}

interface Props {
  onCreated: (board: Board) => void;
  onClose: () => void;
  className?: string;
  // Neu truyen: khoa bang vao dung khong gian nay (an o chon)
  workspaceId?: string;
  // Neu truyen: hien dong "Tao bang bang AI". Component CHA giu trang thai va hien modal nhu
  // ANH EM cua popover nay (popover tu dong khi bam ra ngoai, modal thi nam ngoai vung do).
  onOpenAi?: () => void;
}

export default function CreateBoardDialog({
  onCreated,
  onClose,
  className = '',
  workspaceId: forcedWorkspaceId,
  onOpenAi,
}: Props) {
  const { workspaces, currentWorkspaceId } = useWorkspaces();
  const [view, setView] = useState<'main' | 'photos'>('main');
  const [name, setName] = useState('');
  const [workspaceId, setWorkspaceId] = useState(
    forcedWorkspaceId ?? currentWorkspaceId ?? ''
  );
  const [bg, setBg] = useState<Background>(DEFAULT_BG);
  const touched = useRef(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    photos,
    loading: loadingPhotos,
    loadingMore,
    error: photosError,
    unavailable: unsplashOff,
    search,
    setSearch,
    loadMore,
    canLoadMore,
    onFirstLoad,
  } = useUnsplashPhotos();

  // Chua chon gi -> lay anh dau lam mac dinh (giong Trello)
  useEffect(() => {
    onFirstLoad((ps) => {
      if (!touched.current && ps[0]) setBg(bgToImage(ps[0]));
    });
  }, [onFirstLoad]);

  // Khong gian mac dinh khi context tai xong
  useEffect(() => {
    if (!workspaceId && (forcedWorkspaceId || currentWorkspaceId)) {
      setWorkspaceId(forcedWorkspaceId ?? currentWorkspaceId ?? '');
    }
  }, [workspaceId, forcedWorkspaceId, currentWorkspaceId]);

  function pick(next: Background) {
    touched.current = true;
    setBg(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    if (!workspaceId) {
      setError('Hãy chọn không gian làm việc.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const board = await createBoard({
        name: name.trim(),
        workspaceId,
        color: bg.type === 'color' ? bg.value : undefined,
        backgroundImage: bg.type === 'image' ? bg.url : undefined,
      });
      if (bg.type === 'image') void trackUnsplashDownload(bg.downloadLocation);
      onCreated(board);
    } catch (err) {
      setError(getErrorMessage(err, 'Không tạo được bảng.'));
      setSubmitting(false);
    }
  }

  function onNameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') onClose();
  }

  const quickPhotos = photos.slice(0, 4);

  // ---------- Man hinh chon anh ----------
  if (view === 'photos') {
    return (
      <div
        className={`w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-slate-800 dark:text-slate-100 shadow-2xl ${className}`}
      >
        <div className="mb-2 flex items-center">
          <button
            type="button"
            onClick={() => setView('main')}
            aria-label="Quay lại"
            className="rounded p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <p className="flex-1 text-center text-sm font-semibold">
            Ảnh của Unsplash
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm ảnh (biển, núi, bầu trời...)"
          className="mb-2 w-full rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
        />

        {photosError && (
          <p className="mb-2 text-xs text-red-600">{photosError}</p>
        )}

        <div className="max-h-72 overflow-y-auto">
          {loadingPhotos ? (
            <SkeletonRegion label="Đang tải ảnh…" className="grid grid-cols-3 gap-1.5 py-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </SkeletonRegion>
          ) : photos.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Không có ảnh nào.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {photos.map((p) => {
                  const selected = bg.type === 'image' && bg.url === p.fullUrl;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      title={`Ảnh của ${p.attributionName} / Unsplash`}
                      onClick={() => {
                        pick(bgToImage(p));
                        setView('main');
                      }}
                      className={`relative h-16 overflow-hidden rounded-md bg-cover bg-center ring-offset-1 transition ${
                        selected ? 'ring-2 ring-primary' : 'hover:opacity-90'
                      }`}
                      style={{
                        backgroundImage: `url(${p.thumbUrl})`,
                        backgroundColor: p.color,
                      }}
                    />
                  );
                })}
              </div>

              {canLoadMore && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-700 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                >
                  {loadingMore ? 'Đang tải...' : 'Tải thêm ảnh'}
                </button>
              )}
            </>
          )}
        </div>

        <p className="mt-2 text-center text-[11px] text-slate-500 dark:text-slate-400">
          Ảnh cung cấp bởi Unsplash
        </p>
      </div>
    );
  }

  // ---------- Man hinh chinh ----------
  return (
    <form
      onSubmit={submit}
      className={`w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-slate-800 dark:text-slate-100 shadow-2xl ${className}`}
    >
      <div className="mb-2 flex items-center">
        <p className="flex-1 text-center text-sm font-semibold">Tạo bảng</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          className="rounded p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {onOpenAi && (
        <button
          type="button"
          onClick={onOpenAi}
          className="mb-3 flex w-full items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2 text-left text-sm font-medium text-violet-700 transition hover:bg-violet-100 dark:border-violet-800/60 dark:bg-violet-900/20 dark:text-violet-300 dark:hover:bg-violet-900/40"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor" aria-hidden="true">
            <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2zM19 14l.9 2.6L22.5 17.5l-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14z" />
          </svg>
          <span className="flex-1">
            Tạo bằng AI
            <span className="block text-[11px] font-normal text-violet-600/80 dark:text-violet-300/80">
              Từ mô tả hoặc tệp báo cáo
            </span>
          </span>
        </button>
      )}

      <Preview bg={bg} />

      <p className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">Phông nền</p>

      {!unsplashOff && (
        <div className="mb-2 grid grid-cols-5 gap-1.5">
          {quickPhotos.map((p) => {
            const selected = bg.type === 'image' && bg.url === p.fullUrl;
            return (
              <button
                key={p.id}
                type="button"
                title={`Ảnh của ${p.attributionName} / Unsplash`}
                onClick={() => pick(bgToImage(p))}
                className={`relative h-10 overflow-hidden rounded-md bg-cover bg-center ${
                  selected ? 'ring-2 ring-primary ring-offset-1' : ''
                }`}
                style={{
                  backgroundImage: `url(${p.thumbUrl})`,
                  backgroundColor: p.color,
                }}
              />
            );
          })}
          {loadingPhotos && quickPhotos.length === 0 && (
            <>
              <span className="h-10 animate-pulse rounded-md bg-slate-200 dark:bg-slate-600" />
              <span className="h-10 animate-pulse rounded-md bg-slate-200 dark:bg-slate-600" />
              <span className="h-10 animate-pulse rounded-md bg-slate-200 dark:bg-slate-600" />
              <span className="h-10 animate-pulse rounded-md bg-slate-200 dark:bg-slate-600" />
            </>
          )}
          <button
            type="button"
            onClick={() => setView('photos')}
            aria-label="Xem thêm ảnh"
            className="grid h-10 place-items-center rounded-md bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
        </div>
      )}

      <div className="mb-2 grid grid-cols-8 gap-1.5">
        {BOARD_COLORS.map((c) => {
          const selected = bg.type === 'color' && bg.value === c;
          return (
            <button
              key={c}
              type="button"
              aria-label={`Màu ${c}`}
              onClick={() => pick({ type: 'color', value: c })}
              className={`h-6 rounded ${
                selected ? 'ring-2 ring-slate-800 ring-offset-1' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          );
        })}
      </div>

      {bg.type === 'image' && (
        <p className="mb-2 truncate text-[11px] text-slate-500 dark:text-slate-400">
          Ảnh:{' '}
          <a
            href={bg.creditUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            {bg.creditName}
          </a>{' '}
          / Unsplash
        </p>
      )}

      <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">
        Tiêu đề bảng <span className="text-red-500">*</span>
      </label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onNameKeyDown}
        placeholder="Nhập tên bảng..."
        className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {!name.trim() && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          👋 Tiêu đề bảng là bắt buộc
        </p>
      )}

      <label className="mb-1 mt-3 block text-xs font-semibold text-slate-500 dark:text-slate-400">
        Không gian làm việc
      </label>
      {forcedWorkspaceId ? (
        <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 8a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 8a3 3 0 100-6M15 20a6 6 0 019-5" />
          </svg>
          {workspaces.find((w) => w.id === forcedWorkspaceId)?.name ??
            'Không gian làm việc'}
        </div>
      ) : (
        <select
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          {workspaces.length === 0 && <option value="">Đang tải...</option>}
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !name.trim()}
        className="mt-3 w-full rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Đang tạo...' : 'Tạo mới'}
      </button>
    </form>
  );
}
