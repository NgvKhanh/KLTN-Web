import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import BoardCard from '../components/BoardCard';
import { Skeleton, SkeletonBoardGrid, SkeletonRegion } from '../components/Skeleton';
import { AiGenerateBoardModal, CreateBoardDialog } from '../components/board/lazy';
import { ModalLoading } from '../components/PageLoading';
import ConfirmDialog from '../components/ConfirmDialog';
import { useBoards } from '../context/BoardsContext';
import { useWorkspaces } from '../context/WorkspacesContext';
import {
  archiveBoard,
  deleteBoard,
  fetchArchivedBoards,
  purgeBoard,
  restoreBoard,
  type ArchivedBoard,
} from '../lib/api/board';
import { assetUrl } from '../lib/assets';
import { logError } from '../lib/logError';
import { getErrorMessage } from '../lib/errorMessage';
import type { Board } from '../types/board';

function CreateBoardTile({
  onCreated,
  workspaceId,
}: {
  onCreated: (board: Board) => void;
  workspaceId?: string;
}) {
  const [open, setOpen] = useState(false);
  // Modal AI o CHA (khong nam trong popover): xem chu thich o CreateBoardMenu trong Header.tsx
  const [aiOpen, setAiOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <>
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-1 rounded-xl bg-slate-200/70 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        <span className="text-xl leading-none">+</span>
        Tạo bảng mới
      </button>

      {open && (
        <Suspense fallback={null}>
          <CreateBoardDialog
            className="tf-menu-in absolute left-0 top-[calc(100%+6px)] z-40"
            workspaceId={workspaceId}
            onClose={() => setOpen(false)}
            onOpenAi={() => {
              setOpen(false);
              setAiOpen(true);
            }}
            onCreated={(board) => {
              onCreated(board);
              setOpen(false);
            }}
          />
        </Suspense>
      )}
    </div>
    {aiOpen && (
      <Suspense fallback={<ModalLoading />}>
        <AiGenerateBoardModal
          workspaceId={workspaceId}
          onClose={() => setAiOpen(false)}
          onCreated={(board) => {
            onCreated(board);
            setAiOpen(false);
          }}
        />
      </Suspense>
    )}
    </>
  );
}

export default function HomePage() {
  const { boards, isLoading, error, reload, upsertBoard, removeBoard, toggleStar } =
    useBoards();
  const { workspaces } = useWorkspaces();

  const starred = boards.filter((b) => b.isStarred);
  const knownWsIds = new Set(workspaces.map((w) => w.id));
  const orphanBoards = boards.filter((b) => !knownWsIds.has(b.workspaceId));

  const [deleteTarget, setDeleteTarget] = useState<Board | null>(null);
  const [permTarget, setPermTarget] = useState<Board | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [archived, setArchived] = useState<ArchivedBoard[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<ArchivedBoard | null>(null);

  const loadArchived = useCallback(() => {
    fetchArchivedBoards()
      .then(setArchived)
      .catch(logError('HomePage: tai bang luu tru'));
  }, []);
  useEffect(() => {
    loadArchived();
  }, [loadArchived]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await archiveBoard(deleteTarget.id);
      removeBoard(deleteTarget.id);
      setDeleteTarget(null);
      loadArchived();
    } catch (err) {
      setActionError(getErrorMessage(err, 'Không lưu trữ được bảng.'));
    } finally {
      setDeleting(false);
    }
  }

  async function handleRestore(b: ArchivedBoard) {
    setActionError(null);
    try {
      await restoreBoard(b.id);
      setArchived((cur) => cur.filter((x) => x.id !== b.id));
      await reload();
    } catch (err) {
      setActionError(getErrorMessage(err, 'Không khôi phục được bảng.'));
    }
  }

  async function confirmPermDelete() {
    if (!permTarget) return;
    setDeleting(true);
    try {
      await deleteBoard(permTarget.id);
      removeBoard(permTarget.id);
      setPermTarget(null);
    } catch (err) {
      setActionError(getErrorMessage(err, 'Không xoá được bảng.'));
    } finally {
      setDeleting(false);
    }
  }

  async function confirmPurge() {
    if (!purgeTarget) return;
    setDeleting(true);
    try {
      await purgeBoard(purgeTarget.id);
      setArchived((cur) => cur.filter((x) => x.id !== purgeTarget.id));
      setPurgeTarget(null);
    } catch (err) {
      setActionError(getErrorMessage(err, 'Không xoá được bảng.'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {(error || actionError) && (
        <p className="text-sm text-red-600">{error ?? actionError}</p>
      )}

      {isLoading ? (
        <SkeletonRegion label="Đang tải danh sách bảng…" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-44" />
          <SkeletonBoardGrid count={8} />
        </SkeletonRegion>
      ) : (
        <>
          {starred.length > 0 && (
            <div className="flex flex-col gap-3">
              <h1 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-400" fill="currentColor">
                  <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
                </svg>
                Được đánh dấu sao
              </h1>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {starred.map((board) => (
                  <BoardCard
                    key={board.id}
                    board={board}
                    onChanged={upsertBoard}
                    onRequestDelete={setDeleteTarget}
                    onRequestPermanentDelete={setPermTarget}
                    onToggleStar={toggleStar}
                  />
                ))}
              </div>
            </div>
          )}

          {workspaces.map((ws) => {
            const wsBoards = boards.filter((b) => b.workspaceId === ws.id);
            return (
              <div key={ws.id} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 8a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 8a3 3 0 100-6M15 20a6 6 0 019-5" />
                  </svg>
                  <h1 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    {ws.name}
                  </h1>
                  <Link
                    to={`/workspaces/${ws.id}`}
                    className="text-xs font-medium text-primary-ink hover:underline"
                  >
                    Quản lý
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {wsBoards.map((board) => (
                    <BoardCard
                      key={board.id}
                      showWorkspace={false}
                      board={board}
                      onChanged={upsertBoard}
                      onRequestDelete={setDeleteTarget}
                      onRequestPermanentDelete={setPermTarget}
                      onToggleStar={toggleStar}
                    />
                  ))}
                  <CreateBoardTile onCreated={upsertBoard} workspaceId={ws.id} />
                </div>
              </div>
            );
          })}

          {orphanBoards.length > 0 && (
            <div className="flex flex-col gap-3">
              <h1 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Bảng khác
              </h1>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {orphanBoards.map((board) => (
                  <BoardCard
                    key={board.id}
                    board={board}
                    onChanged={upsertBoard}
                    onRequestDelete={setDeleteTarget}
                    onRequestPermanentDelete={setPermTarget}
                    onToggleStar={toggleStar}
                  />
                ))}
              </div>
            </div>
          )}

          {archived.length > 0 && (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="4" rx="1" />
                  <path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 12h4" />
                </svg>
                Bảng đã lưu trữ ({archived.length})
                <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${showArchived ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>

              {showArchived && (
                <ul className="flex flex-col gap-2">
                  {archived.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <span
                        className="h-8 w-12 shrink-0 rounded bg-cover bg-center"
                        style={
                          b.backgroundImage
                            ? { backgroundImage: `url(${assetUrl(b.backgroundImage)})` }
                            : { backgroundColor: b.color }
                        }
                      />
                      <span className="flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                        {b.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleRestore(b)}
                        className="rounded bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200"
                      >
                        Khôi phục
                      </button>
                      {b.isOwner && (
                        <button
                          type="button"
                          onClick={() => setPurgeTarget(b)}
                          className="rounded px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          Xoá vĩnh viễn
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Lưu trữ bảng?"
        message={
          deleteTarget
            ? `Bảng "${deleteTarget.name}" sẽ được chuyển vào mục "Bảng đã lưu trữ". Bạn có thể khôi phục lại sau.`
            : undefined
        }
        confirmLabel="Lưu trữ"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={permTarget !== null}
        title="Xoá bảng vĩnh viễn?"
        message={
          permTarget
            ? `Bảng "${permTarget.name}" cùng toàn bộ danh sách và thẻ sẽ bị xoá và không thể khôi phục. Nếu chỉ muốn cất đi, hãy chọn "Lưu trữ bảng".`
            : undefined
        }
        confirmLabel="Xoá vĩnh viễn"
        danger
        busy={deleting}
        onConfirm={confirmPermDelete}
        onCancel={() => !deleting && setPermTarget(null)}
      />

      <ConfirmDialog
        open={purgeTarget !== null}
        title="Xoá vĩnh viễn bảng?"
        message={
          purgeTarget
            ? `Bảng "${purgeTarget.name}" và toàn bộ danh sách, thẻ bên trong sẽ bị xoá và không thể khôi phục.`
            : undefined
        }
        confirmLabel="Xoá vĩnh viễn"
        danger
        busy={deleting}
        onConfirm={confirmPurge}
        onCancel={() => !deleting && setPurgeTarget(null)}
      />
    </div>
  );
}
