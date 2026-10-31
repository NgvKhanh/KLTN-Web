import type { ReactNode } from 'react';

// Nét vẽ (24x24) cho từng kiểu minh hoạ; dùng chung màu chàm của ứng dụng
const ICONS = {
  tasks: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
  activity: 'M3 12h4l2 6 4-14 2 8h6',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3',
  calendar: 'M5 4h14a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM3 10h18M8 2v4M16 2v4',
  boards: 'M4 4h6v16H4zM14 4h6v10h-6z',
} as const;

interface Props {
  icon: keyof typeof ICONS;
  title: string;
  description?: string;
  /** Hành động chính (nút hoặc liên kết) - nên có khi người dùng làm được gì đó để thoát trạng thái trống. */
  action?: ReactNode;
  /** Gọn hơn, dùng trong thẻ/khối nhỏ. */
  compact?: boolean;
}

/** Trạng thái trống: biểu tượng + câu giải thích + hành động (nếu có). */
export default function EmptyState({ icon, title, description, action, compact = false }: Props) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'gap-2 py-4' : 'gap-3 py-10'}`}>
      <span
        aria-hidden="true"
        className={`grid place-items-center rounded-2xl bg-primary-soft text-primary-ink ${
          compact ? 'h-10 w-10' : 'h-14 w-14'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className={compact ? 'h-5 w-5' : 'h-7 w-7'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={ICONS[icon]} />
        </svg>
      </span>
      <p className={`font-semibold text-slate-800 dark:text-slate-100 ${compact ? 'text-sm' : 'text-base'}`}>{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {action}
    </div>
  );
}
