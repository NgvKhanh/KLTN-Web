import { STATUS_META } from '../../lib/cardStatus';
import type { TemplateList } from '../../lib/templates';

const BAR_WIDTHS = ['100%', '78%', '90%'];

/**
 * Hình thu nhỏ của bảng mẫu: nền theo màu bảng, mỗi cột một khung (chấm nhỏ ở đầu cột = trạng thái của cột:
 * xanh / tím / lục / đỏ, xám nhạt = cột tự do), mỗi thẻ ví dụ (tối đa 3) một thanh.
 */
export default function TemplateThumb({ color, lists, height = 'h-20' }: { color: string; lists: TemplateList[]; height?: string }) {
  return (
    <div aria-hidden="true" className={`flex ${height} items-start gap-1.5 overflow-hidden px-3 pt-3`} style={{ backgroundColor: color }}>
      {lists.slice(0, 5).map((l) => (
        <div key={l.name} className="flex min-w-0 flex-1 flex-col gap-1 rounded-md bg-white/75 p-1.5 dark:bg-slate-900/60">
          <span className="flex items-center gap-1">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.status ? STATUS_META[l.status].dot : 'bg-slate-300'}`} />
            <span className="h-1.5 flex-1 rounded-full bg-slate-500/40" />
          </span>
          {Array.from({ length: Math.min(3, l.cards.length) }, (_, i) => (
            <span key={i} className="block h-2.5 rounded bg-white shadow-sm dark:bg-slate-700" style={{ width: BAR_WIDTHS[i] }} />
          ))}
        </div>
      ))}
    </div>
  );
}
