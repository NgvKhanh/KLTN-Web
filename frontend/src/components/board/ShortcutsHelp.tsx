import { useEffect } from 'react';
import { createPortal } from 'react-dom';

const ROWS: { keys: string[]; desc: string }[] = [
  { keys: ['N'], desc: 'Thêm thẻ vào danh sách đầu tiên' },
  { keys: ['F'], desc: 'Mở / đóng bộ lọc' },
  { keys: ['X'], desc: 'Xoá bộ lọc đang áp dụng' },
  { keys: ['Q'], desc: 'Lọc nhanh: thẻ được giao cho tôi' },
  { keys: ['B'], desc: 'Mở bảng chọn hình nền' },
  { keys: ['?'], desc: 'Hiện / ẩn bảng phím tắt này' },
  { keys: ['Esc'], desc: 'Đóng cửa sổ / bảng đang mở' },
];

export default function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="tf-overlay fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-80 rounded-xl bg-white dark:bg-slate-800 p-4 shadow-2xl">
        <div className="mb-3 flex items-center">
          <p className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Phím tắt</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
            aria-label="Đóng"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {ROWS.map((r) => (
            <li key={r.desc} className="flex items-center gap-3 text-sm">
              <span className="flex shrink-0 gap-1">
                {r.keys.map((k) => (
                  <kbd
                    key={k}
                    className="min-w-[24px] rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-1.5 py-0.5 text-center text-xs font-semibold text-slate-600 dark:text-slate-300"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
              <span className="text-slate-600 dark:text-slate-300">{r.desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body
  );
}
