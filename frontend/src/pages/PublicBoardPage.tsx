import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Avatar from '../components/Avatar';
import CommentThread from '../components/board/cardModal/CommentThread';
import { fmt, formatBytes } from '../components/board/cardModal/helpers';
import { groupCommentThreads } from '../lib/commentThreads';
import { useAuth } from '../context/AuthContext';
import { assetUrl } from '../lib/assets';
import { getErrorMessage } from '../lib/errorMessage';
import {
  fetchPublicBoard,
  fetchPublicBoardLists,
  fetchPublicCard,
} from '../lib/api/publicBoard';
import { MiniMarkdown } from '../lib/miniMarkdown';
import Logo from '../components/Logo';
import type {
  PublicBoard,
  PublicCardDetail,
  PublicList,
} from '../types/publicBoard';
import { Skeleton, SkeletonColumns, SkeletonRegion } from '../components/Skeleton';

// Trang xem 1 bang PUBLIC - KHONG can dang nhap, chi doc (khong sua/binh luan).
// Dung cho lien ket chia se cong khai: /public/boards/:boardId
export default function PublicBoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const { user } = useAuth();

  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [lists, setLists] = useState<PublicList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  useEffect(() => {
    if (!boardId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([fetchPublicBoard(boardId), fetchPublicBoardLists(boardId)])
      .then(([b, ls]) => {
        if (!alive) return;
        setBoard(b);
        setLists(ls);
      })
      .catch((err) => {
        if (!alive) return;
        setError(
          getErrorMessage(
            err,
            'Không tìm thấy bảng này, hoặc bảng không ở chế độ công khai.'
          )
        );
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [boardId]);

  const bgStyle = board?.backgroundImage
    ? {
        backgroundImage: `url(${assetUrl(board.backgroundImage)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { backgroundColor: board?.color ?? '#0c66e4' };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-700 dark:bg-slate-900">
        <Link to="/" className="flex items-center gap-2">
          <Logo markClassName="h-7 w-7" textClassName="text-lg font-extrabold tracking-tight text-slate-800 dark:text-white" />
        </Link>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Xem công khai · chỉ đọc
        </span>
        <div className="ml-auto">
          {user ? (
            <Link
              to="/boards"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-hover"
            >
              Về TaskFlow
            </Link>
          ) : (
            <Link
              to="/login"
              state={{ from: `/boards/${boardId}` }}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-hover"
            >
              Đăng nhập
            </Link>
          )}
        </div>
      </header>

      {loading ? (
        <SkeletonRegion label="Đang tải bảng…" className="flex-1 overflow-hidden p-4">
          <SkeletonColumns onColor />
        </SkeletonRegion>
      ) : error || !board ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="text-slate-600 dark:text-slate-300">
            {error ?? 'Không tìm thấy bảng này.'}
          </p>
          <Link to="/login" state={{ from: `/boards/${boardId}` }} className="text-sm font-medium text-primary-ink hover:underline">
            Đăng nhập để xem thêm
          </Link>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto" style={bgStyle}>
          <div className="flex h-full flex-col bg-black/10">
            <div className="px-4 pt-4">
              <h1 className="text-lg font-bold text-white drop-shadow-sm">
                {board.name}
              </h1>
              {board.workspaceName && (
                <p className="text-xs text-white/80">{board.workspaceName}</p>
              )}
            </div>
            <div className="flex flex-1 items-start gap-3 overflow-x-auto p-4">
              {lists.map((l) => (
                <div
                  key={l.id}
                  className="flex max-h-full w-[272px] shrink-0 flex-col rounded-xl bg-[#f1f2f4]/95 shadow-sm backdrop-blur-sm dark:bg-slate-800/95"
                >
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <span className="flex-1 truncate px-2 py-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {l.name}
                    </span>
                    <span className="shrink-0 px-1 text-xs text-slate-600 dark:text-slate-300">
                      {l.cards.length}
                    </span>
                  </div>
                  <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                    {l.cards.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setOpenCardId(c.id)}
                        className="block w-full overflow-hidden rounded-lg bg-white text-left shadow-sm ring-1 ring-black/5 hover:ring-primary/50 dark:bg-slate-700"
                      >
                        {(c.coverImageUrl || c.coverColor) && (
                          <div
                            className="h-16 bg-cover bg-center"
                            style={
                              c.coverImageUrl
                                ? { backgroundImage: `url(${assetUrl(c.coverImageUrl)})` }
                                : { backgroundColor: c.coverColor as string }
                            }
                          />
                        )}
                        <div className="p-2">
                          {c.labels.length > 0 && (
                            <div className="mb-1 flex flex-wrap gap-1">
                              {c.labels.map((l2) => (
                                <span
                                  key={l2.labelId}
                                  className="h-1.5 w-8 rounded-full"
                                  style={{ backgroundColor: l2.label.color }}
                                  title={l2.label.name}
                                />
                              ))}
                            </div>
                          )}
                          <p
                            className={`text-sm ${
                              c.isDone
                                ? 'text-slate-500 line-through dark:text-slate-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {c.title}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            {c.dueDate && <span>📅 {fmt(c.dueDate)}</span>}
                            {c._count.checklists > 0 && <span>☑ checklist</span>}
                            {c._count.comments > 0 && <span>💬 {c._count.comments}</span>}
                            {c._count.attachments > 0 && <span>📎 {c._count.attachments}</span>}
                            {c.members.length > 0 && (
                              <span className="ml-auto flex -space-x-1">
                                {c.members.map((m) => (
                                  <Avatar
                                    key={m.userId}
                                    id={m.userId}
                                    name={m.user.name}
                                    avatarUrl={m.user.avatarUrl}
                                    className="h-5 w-5 text-[9px]"
                                  />
                                ))}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                    {l.cards.length === 0 && (
                      <p className="px-2 py-2 text-xs text-slate-400">Không có thẻ.</p>
                    )}
                  </div>
                </div>
              ))}
              {lists.length === 0 && (
                <p className="px-2 py-4 text-sm text-white/80">Bảng chưa có danh sách nào.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {openCardId && (
        <PublicCardOverlay cardId={openCardId} onClose={() => setOpenCardId(null)} />
      )}
    </div>
  );
}

function PublicCardOverlay({
  cardId,
  onClose,
}: {
  cardId: string;
  onClose: () => void;
}) {
  const [card, setCard] = useState<PublicCardDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPublicCard(cardId)
      .then((c) => alive && setCard(c))
      .catch((err) => alive && setError(getErrorMessage(err, 'Không tải được thẻ.')));
    return () => {
      alive = false;
    };
  }, [cardId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="tf-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-12">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {card?.list.name ?? 'Đang tải...'}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded p-1.5 text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-600"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {error ? (
          <p className="p-4 text-sm text-red-600">{error}</p>
        ) : !card ? (
          <SkeletonRegion label="Đang tải thẻ…" className="flex flex-col gap-3 p-4">
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-16 w-full" />
          </SkeletonRegion>
        ) : (
          <div className="p-4">
            <h2
              className={`mb-2 text-lg font-semibold ${
                card.isDone ? 'text-slate-500 line-through' : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {card.title}
            </h2>

            {(card.labels.length > 0 || card.startDate || card.dueDate || card.members.length > 0) && (
              <div className="mb-4 flex flex-wrap gap-4">
                {card.labels.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">Nhãn</p>
                    <div className="flex flex-wrap gap-1">
                      {card.labels.map((l) => (
                        <span
                          key={l.labelId}
                          className="rounded px-2 py-1 text-xs font-medium text-white"
                          style={{ backgroundColor: l.label.color }}
                        >
                          {l.label.name || '   '}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {(card.startDate || card.dueDate) && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">
                      {card.startDate && card.dueDate ? 'Ngày bắt đầu → hết hạn' : card.startDate ? 'Ngày bắt đầu' : 'Ngày hết hạn'}
                    </p>
                    <span className="inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {[card.startDate, card.dueDate].filter(Boolean).map((d) => fmt(d as string)).join('  →  ')}
                    </span>
                  </div>
                )}
                {card.members.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">Thành viên</p>
                    <div className="flex -space-x-1">
                      {card.members.map((m) => (
                        <Avatar key={m.userId} id={m.userId} name={m.user.name} avatarUrl={m.user.avatarUrl} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mb-5">
              <p className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Mô tả</p>
              <div className="rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                {card.description ? (
                  <MiniMarkdown text={card.description} />
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Không có mô tả.</p>
                )}
              </div>
            </div>

            {card.checklists.map((cl) => {
              const done = cl.items.filter((i) => i.isDone).length;
              return (
                <div key={cl.id} className="mb-4">
                  <p className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {cl.title}{' '}
                    <span className="font-normal text-xs text-slate-500">
                      {done}/{cl.items.length}
                    </span>
                  </p>
                  <div className="space-y-1">
                    {cl.items.map((it) => (
                      <label key={it.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                        <input type="checkbox" checked={it.isDone} disabled />
                        <span className={it.isDone ? 'text-slate-400 line-through' : ''}>{it.content}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            {card.attachments.length > 0 && (
              <div className="mb-4">
                <p className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Đính kèm</p>
                <ul className="space-y-1">
                  {card.attachments.map((a) => (
                    <li key={a.id}>
                      <a
                        href={assetUrl(a.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary-ink hover:underline"
                      >
                        {a.name}
                      </a>
                      <span className="ml-1 text-xs text-slate-400">({formatBytes(a.size)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Bình luận</p>
              {card.comments.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Chưa có bình luận.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {groupCommentThreads(card.comments).map((t) => (
                    <CommentThread key={t.root.id} thread={t} readOnly />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
