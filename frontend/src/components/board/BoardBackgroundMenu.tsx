import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  clearBoardBackground,
  updateBoard,
} from '../../lib/api/board';
import { trackUnsplashDownload } from '../../lib/api/unsplash';
import { BOARD_COLORS } from '../../lib/boardColors';
import { getErrorMessage } from '../../lib/errorMessage';
import { useUnsplashPhotos } from '../../lib/useUnsplashPhotos';
import type { Board } from '../../types/board';
import { Skeleton, SkeletonRegion } from '../Skeleton';

interface Props {
  board: Board;
  onChanged: (board: Board) => void;
  onClose: () => void;
}

// Menu "Thay doi hinh nen" cho 1 bang dang mo: chon mau hoac anh Unsplash.
export default function BoardBackgroundMenu({
  board,
  onChanged,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (
        ref.current &&
        !ref.current.contains(t) &&
        !t.closest('[data-bg-trigger]')
      ) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const {
    photos,
    loading,
    loadingMore,
    error: photosError,
    unavailable,
    search,
    setSearch,
    loadMore,
    canLoadMore,
  } = useUnsplashPhotos();

  const hasImage = Boolean(board.backgroundImage);

  async function run(action: () => Promise<Board>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action());
    } catch (err) {
      setError(getErrorMessage(err, 'Không đổi được hình nền.'));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      ref={ref}
      className="tf-menu-in fixed right-3 top-14 z-50 max-h-[80vh] w-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-slate-800 dark:text-slate-100 shadow-2xl"
    >
      <div className="mb-2 flex items-center">
        <p className="flex-1 text-center text-sm font-semibold">
          Thay đổi hình nền
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

      <p className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">Màu</p>
      <div className="mb-3 grid grid-cols-4 gap-1.5">
        {BOARD_COLORS.map((c) => {
          const selected = !hasImage && board.color === c;
          return (
            <button
              key={c}
              type="button"
              disabled={busy}
              aria-label={`Màu ${c}`}
              onClick={() => void run(() => updateBoard(board.id, { color: c }))}
              className={`h-8 rounded-md disabled:opacity-50 ${
                selected ? 'ring-2 ring-slate-800 ring-offset-1' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          );
        })}
      </div>

      {unavailable ? (
        <p className="rounded-lg bg-slate-50 dark:bg-slate-700 px-2 py-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          Chưa cấu hình Unsplash trên server nên chưa chọn ảnh được.
        </p>
      ) : (
        <>
          <p className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
            Ảnh của Unsplash
          </p>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm ảnh (biển, núi, bầu trời...)"
            className="mb-2 w-full rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
          />

          {(error || photosError) && (
            <p className="mb-2 text-xs text-red-600">{error ?? photosError}</p>
          )}

          <div className="max-h-56 overflow-y-auto">
            {loading ? (
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
                <div className="grid grid-cols-3 gap-1.5">
                  {photos.map((p) => {
                    const selected = board.backgroundImage === p.fullUrl;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={busy}
                        title={`Ảnh của ${p.attributionName} / Unsplash`}
                        onClick={() =>
                          void run(async () => {
                            const b = await updateBoard(board.id, {
                              backgroundImage: p.fullUrl,
                            });
                            void trackUnsplashDownload(p.downloadLocation);
                            return b;
                          })
                        }
                        className={`relative h-14 overflow-hidden rounded-md bg-cover bg-center transition disabled:opacity-50 ${
                          selected
                            ? 'ring-2 ring-primary ring-offset-1'
                            : 'hover:opacity-90'
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
        </>
      )}

      {hasImage && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => clearBoardBackground(board.id))}
          className="mt-2 w-full rounded-lg py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
        >
          Bỏ hình nền (quay về màu)
        </button>
      )}
    </div>,
    document.body
  );
}
