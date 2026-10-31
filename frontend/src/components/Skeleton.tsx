import type { ReactNode } from 'react';

/** Khối chờ (skeleton): chỉ để trang trí nên ẩn với trình đọc màn hình. */
export function Skeleton({
  className = '',
  onColor = false,
}: {
  className?: string;
  /** true khi đặt trên nền màu/ảnh của bảng (dùng nền trắng mờ thay vì xám). */
  onColor?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`tf-skeleton block rounded-md ${onColor ? 'tf-skeleton-on-color' : ''} ${className}`}
    />
  );
}

/**
 * Vùng đang tải: có thông báo ngắn cho trình đọc màn hình, bên trong là các Skeleton.
 * `label` là câu mà trình đọc màn hình sẽ đọc (ví dụ "Đang tải danh sách bảng…").
 */
export function SkeletonRegion({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Lưới thẻ bảng chờ, cùng kích thước xấp xỉ BoardCard (cao 10rem, bo 12px). */
export function SkeletonBoardGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-40 rounded-xl" />
      ))}
    </div>
  );
}

/** Danh sách dòng chờ (avatar/ô tròn + tiêu đề + thông tin phụ). `boxed` = nằm trong khung viền như danh sách thật. */
export function SkeletonRows({ rows = 4, boxed = false }: { rows?: number; boxed?: boolean }) {
  const list = (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-3 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
  if (!boxed) return list;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      {list}
    </div>
  );
}

/** Các cột Kanban chờ (rộng 272px như cột thật), mỗi cột vài thẻ mờ. */
export function SkeletonColumns({ columns = 3, onColor = false }: { columns?: number; onColor?: boolean }) {
  const cardCounts = [4, 3, 2, 3];
  return (
    <div className="flex items-start gap-3">
      {Array.from({ length: columns }, (_, c) => (
        <div key={c} className="flex w-[272px] shrink-0 flex-col gap-2 rounded-xl bg-white/40 p-2 dark:bg-slate-800/60">
          <Skeleton onColor={onColor} className="h-5 w-28" />
          {Array.from({ length: cardCounts[c % cardCounts.length] }, (_, i) => (
            <Skeleton key={i} onColor={onColor} className="h-14 rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}
