import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { BoardVisibility } from '../../types/board';

interface Props {
  value: BoardVisibility;
  onChange: (v: BoardVisibility) => void;
  onClose: () => void;
}

const OPTIONS: {
  key: BoardVisibility;
  label: string;
  desc: string;
  icon: ReactNode;
}[] = [
  {
    key: 'PRIVATE',
    label: 'Riêng tư',
    desc: 'Chỉ thành viên của bảng mới xem được. Chủ bảng có thể quản lý thành viên.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 018 0v4" />
      </svg>
    ),
  },
  {
    key: 'WORKSPACE',
    label: 'Không gian làm việc',
    desc: 'Mọi thành viên của không gian chứa bảng đều xem và sửa được bảng này.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 8a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 8a3 3 0 100-6M15 20a6 6 0 019-5" />
      </svg>
    ),
  },
  {
    key: 'PUBLIC',
    label: 'Công khai',
    desc: 'Bất kỳ ai có liên kết đều xem được bảng này (chỉ đọc). Chỉ thành viên mới sửa.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
      </svg>
    ),
  },
];

export default function BoardVisibilityMenu({
  value,
  onChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (
        ref.current &&
        !ref.current.contains(t) &&
        !t.closest('[data-visibility-trigger]')
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

  return createPortal(
    <div
      ref={ref}
      className="tf-menu-in fixed right-3 top-14 z-50 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-800 dark:text-slate-100 shadow-2xl"
    >
      <div className="flex items-center px-1.5 pb-1">
        <p className="flex-1 text-center text-sm font-semibold">
          Thay đổi khả năng hiển thị
        </p>
      </div>
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => {
            onChange(o.key);
            onClose();
          }}
          className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          <span className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400">{o.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {o.label}
              {value === o.key && (
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-primary-ink" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{o.desc}</span>
          </span>
        </button>
      ))}
    </div>,
    document.body
  );
}
