import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MyCard } from '../../lib/api/card';
import { assetUrl } from '../../lib/assets';
import { BOARD_TABS, boardsForTab, workByBoard, type BoardTab } from '../../lib/homeBoards';
import { getRecentBoards } from '../../lib/recentBoards';
import type { Board } from '../../types/board';
import Segmented from './Segmented';

const TAB_KEY = 'tf.home.boardTab';

// Tab dang chon chi la tien ich cua tung may: doc/ghi loi (an danh, chan luu tru) thi dung mac dinh
function readTab(): BoardTab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return BOARD_TABS.some((t) => t.key === v) ? (v as BoardTab) : 'recent';
  } catch {
    return 'recent';
  }
}

function saveTab(tab: BoardTab) {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // bo qua
  }
}

const EMPTY_TEXT: Record<BoardTab, string> = {
  recent: 'Bạn chưa có bảng nào.',
  starred: 'Chưa có bảng nào được đánh dấu sao.',
  mine: 'Bạn không có thẻ nào đang mở trên các bảng.',
};

export default function BoardProgressList({ boards, cards, now }: { boards: Board[]; cards: MyCard[]; now: Date }) {
  const [tab, setTab] = useState<BoardTab>(readTab);
  const work = useMemo(() => workByBoard(cards, now), [cards, now]);
  // Danh sach bang da mo doc tu localStorage moi lan bang/tab doi (vua mo bang xong quay lai thi thay ngay)
  const shown = useMemo(() => boardsForTab(tab, boards, getRecentBoards(), work), [tab, boards, work]);

  function choose(next: BoardTab) {
    setTab(next);
    saveTab(next);
  }

  return (
    <>
      <div className="mb-3">
        <Segmented label="Lọc bảng" options={BOARD_TABS} value={tab} onChange={choose} />
      </div>

      {shown.length === 0 ? (
        <p className="px-2 py-3 text-sm text-slate-500 dark:text-slate-400">{EMPTY_TEXT[tab]}</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((b) => {
            const w = work.get(b.id);
            const total = b.cardCount ?? 0;
            const done = b.doneCount ?? 0;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <li
                key={b.id}
                className="relative flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-100 dark:hover:bg-slate-700/60"
              >
                <span
                  aria-hidden="true"
                  className="h-9 w-12 shrink-0 rounded-md ring-1 ring-black/5"
                  style={
                    b.backgroundImage
                      ? {
                          backgroundImage: `url(${assetUrl(b.backgroundImage)})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }
                      : { backgroundColor: b.color }
                  }
                />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/boards/${b.id}`}
                    className="block truncate text-sm font-medium text-slate-800 after:absolute after:inset-0 after:rounded-lg focus-visible:outline-2 focus-visible:outline-primary dark:text-slate-100"
                  >
                    {b.name}
                  </Link>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {w ? (
                      <>
                        {w.open} thẻ của bạn
                        {w.overdue > 0 && (
                          <span className="text-red-700 dark:text-red-300"> · {w.overdue} quá hạn</span>
                        )}
                      </>
                    ) : (
                      'Không có thẻ nào của bạn'
                    )}
                    {b.workspaceName && <> · {b.workspaceName}</>}
                  </p>
                </div>
                <div className="w-24 shrink-0 sm:w-40">
                  {total > 0 ? (
                    <>
                      <span className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>{pct}%</span>
                        <span className="tabular-nums">
                          {done}/{total}
                        </span>
                      </span>
                      <span
                        role="progressbar"
                        aria-label={`Tiến độ bảng ${b.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                        className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                      >
                        <span className="tf-bar-in block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </span>
                    </>
                  ) : (
                    <span className="block text-right text-[11px] text-slate-400 dark:text-slate-500">Chưa có thẻ</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
