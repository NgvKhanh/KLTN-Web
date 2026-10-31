import { STATUS_META } from '../../lib/cardStatus';
import type { CardStatus } from '../../types/card';

// Vien trang thai nho: cham mau + nhan. Dung chung cho the, header cot, bang, chi tiet the.
export default function StatusBadge({
  status,
  className = '',
}: {
  status: CardStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium ${meta.pill} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
