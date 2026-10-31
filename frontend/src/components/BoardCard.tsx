import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  clearBoardBackground,
  updateBoard,
  uploadBoardBackground,
} from '../lib/api/board';
import { assetUrl } from '../lib/assets';
import { BOARD_COLORS } from '../lib/boardColors';
import { getErrorMessage } from '../lib/errorMessage';
import type { Board } from '../types/board';
import StarButton from './StarButton';

interface Props {
  board: Board;
  onChanged: (board: Board) => void;
  onRequestDelete: (board: Board) => void;
  onRequestPermanentDelete?: (board: Board) => void;
  onToggleStar: (boardId: string) => void;
  // false khi thẻ nằm dưới tiêu đề đã ghi tên không gian làm việc (đỡ lặp, đỡ bị cắt chữ)
  showWorkspace?: boolean;
}

export default function BoardCard({
  board,
  onChanged,
  onRequestDelete,
  onRequestPermanentDelete,
  onToggleStar,
  showWorkspace = true,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const hasImage = Boolean(board.backgroundImage);
  const bgStyle = hasImage
    ? {
        backgroundImage: `url(${assetUrl(board.backgroundImage)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { backgroundColor: board.color };

  async function run(action: () => Promise<Board>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action());
      setMenuOpen(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Thao tác thất bại.'));
    } finally {
      setBusy(false);
    }
  }

  function pickColor(color: string) {
    void run(() => updateBoard(board.id, { color }));
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // cho phep chon lai cung file
    if (file) void run(() => uploadBoardBackground(board.id, file));
  }

  const cardCount = board.cardCount;
  const doneCount = board.doneCount ?? 0;
  const hasProgress = typeof cardCount === 'number' && cardCount > 0;
  const donePct = hasProgress ? Math.round((doneCount / cardCount) * 100) : 0;
  const memberLabel =
    typeof board.memberCount === 'number' && board.memberCount > 0
      ? `${board.memberCount} thành viên`
      : null;
  // Chỉ hiện các thông tin CÓ thật; thiếu thì ẩn chứ không thay bằng số 0
  const subline = [showWorkspace ? board.workspaceName : null, memberLabel].filter(Boolean).join(' · ');
  const updated = board.updatedAt
    ? new Date(board.updatedAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
    : null;

  return (
    <div
      className={`group relative rounded-xl bg-white shadow-sm ring-1 ring-black/5 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-800 dark:ring-white/10 ${
        menuOpen ? 'z-40' : ''
      }`}
    >
      {/* Ảnh bìa + thông tin - bấm vào để mở bảng; bo cắt riêng để menu bên ngoài không bị che */}
      <Link
        to={`/boards/${board.id}`}
        title={board.name}
        className="block overflow-hidden rounded-xl"
      >
        <span style={bgStyle} className="block h-20" aria-hidden="true" />
        <span className="block px-3 pb-3 pt-2">
          <span className="line-clamp-2 block text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">
            {board.name}
          </span>
          {subline && (
            <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
              {subline}
            </span>
          )}
          <span className="mt-2 block">
            {hasProgress ? (
              <>
                <span
                  role="progressbar"
                  aria-label="Tiến độ hoàn thành thẻ"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={donePct}
                  className="block h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                >
                  <span
                    className="tf-bar-in block h-full rounded-full bg-emerald-500"
                    style={{ width: `${donePct}%` }}
                  />
                </span>
                <span className="mt-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>
                    {doneCount}/{cardCount} thẻ hoàn thành
                  </span>
                  {updated && <span title="Ngày cập nhật bảng">Cập nhật {updated}</span>}
                </span>
              </>
            ) : (
              <span className="flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
                <span>{typeof cardCount === 'number' ? 'Chưa có thẻ' : ''}</span>
                {updated && <span title="Ngày cập nhật bảng">Cập nhật {updated}</span>}
              </span>
            )}
          </span>
        </span>
      </Link>

      {/* Nut sao */}
      <div
        className={`absolute left-1.5 top-1.5 z-10 grid h-7 w-7 place-items-center rounded-lg bg-black/30 backdrop-blur-sm transition-opacity ${
          board.isStarred ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <StarButton
          starred={Boolean(board.isStarred)}
          onToggle={() => onToggleStar(board.id)}
          className={board.isStarred ? '' : 'text-white'}
        />
      </div>

      {/* Nut ... */}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Tuỳ chọn bảng"
        aria-expanded={menuOpen}
        className="absolute right-1.5 top-1.5 z-10 grid h-7 w-7 place-items-center rounded-lg bg-black/30 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/50 group-hover:opacity-100 aria-expanded:opacity-100"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Đóng menu"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="tf-menu-in absolute right-0 top-[calc(100%+4px)] z-40 w-56 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <p className="mb-1.5 text-xs font-semibold text-slate-500">Ảnh nền</p>

            <div className="grid grid-cols-4 gap-1.5">
              {BOARD_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={busy}
                  onClick={() => pickColor(c)}
                  aria-label={`Màu ${c}`}
                  className={`h-7 rounded-md disabled:opacity-50 ${
                    !hasImage && board.color === c
                      ? 'ring-2 ring-slate-800 ring-offset-1'
                      : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
              </svg>
              {busy ? 'Đang tải...' : 'Tải ảnh lên'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={onFileChange}
            />

            {hasImage && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => clearBoardBackground(board.id))}
                className="mt-1 w-full rounded-md py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Bỏ ảnh nền
              </button>
            )}

            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

            <div className="my-2 border-t border-slate-200" />

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onRequestDelete(board);
              }}
              className="w-full rounded-md py-1.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Lưu trữ bảng
            </button>
            {board.isOwner && onRequestPermanentDelete && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onRequestPermanentDelete(board);
                }}
                className="w-full rounded-md py-1.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Xoá bảng vĩnh viễn
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
