import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Tên hộp điều hướng, đọc cho trình đọc màn hình và hiện ở đầu ngăn. */
  label: string;
  children: ReactNode;
}

/**
 * Ngăn điều hướng mở từ cạnh trái cho màn hình dưới 768px.
 * Đóng khi: nhấn Escape, bấm nền, chọn một liên kết, hoặc màn hình rộng ra tới desktop.
 * Quản lý focus: vào ngăn khi mở, giữ Tab trong ngăn, trả về nút đã mở khi đóng.
 * Phím bấm trong ngăn không lọt ra ngoài (tránh kích hoạt phím tắt của bảng ở phía sau).
 */
export default function NavDrawer({ open, onClose, label, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => {
      opener?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (mq.matches) onClose();
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [open, onClose]);

  if (!open) return null;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Không cho phím bấm trong ngăn đến các phím tắt ở document
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const firstItem = items[0]!;
    const lastItem = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === firstItem) {
      e.preventDefault();
      lastItem.focus();
    } else if (!e.shiftKey && document.activeElement === lastItem) {
      e.preventDefault();
      firstItem.focus();
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 md:hidden" onKeyDown={onKeyDown}>
      <div className="tf-drawer-backdrop absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) onClose();
        }}
        className="tf-drawer-in absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto bg-white shadow-2xl outline-none dark:bg-slate-800"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng điều hướng"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
      </div>
    </div>,
    document.body
  );
}
