import { createPortal } from 'react-dom';

/**
 * Hiện khi hộp chi tiết thẻ gặp lỗi lúc dựng giao diện (dùng làm `fallback` của ErrorBoundary quanh CardModal).
 * Bảng phía sau vẫn dùng được: người dùng đóng hộp này là quay lại bảng, hoặc thử mở lại thẻ.
 */
export default function CardModalCrash({
  onClose,
  onRetry,
}: {
  onClose: () => void;
  onRetry: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="card-crash-title"
        className="w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-xl dark:bg-slate-800"
      >
        <h2 id="card-crash-title" className="text-base font-semibold text-slate-800 dark:text-slate-100">
          Không mở được thẻ này
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Thẻ gặp lỗi khi hiển thị. Dữ liệu đã lưu không bị ảnh hưởng.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Thử lại
          </button>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
