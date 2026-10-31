import type { BoardList } from '../../types/list';

// Ban "noi" cua cot khi dang keo - chi de hien thi, khong tuong tac.
export default function ListColumnOverlay({ list }: { list: BoardList }) {
  return (
    <div className="flex w-72 rotate-2 flex-col rounded-xl bg-[#f1f2f4] shadow-2xl ring-1 ring-black/10 dark:bg-slate-800 dark:ring-white/10">
      <div className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
        {list.name}
      </div>
      <div className="flex flex-col gap-2 px-2 pb-2">
        {list.cards.slice(0, 6).map((card) => (
          <div
            key={card.id}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          >
            {card.title}
          </div>
        ))}
        {list.cards.length > 6 && (
          <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
            +{list.cards.length - 6} thẻ nữa
          </p>
        )}
      </div>
    </div>
  );
}
