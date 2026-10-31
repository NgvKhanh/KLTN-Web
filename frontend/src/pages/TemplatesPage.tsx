import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBoards } from '../context/BoardsContext';
import { useWorkspaces } from '../context/WorkspacesContext';
import { createBoardFromTemplate, fetchTemplates, type TemplateCategory } from '../lib/api/board';
import { createBoardFromUserTemplate, deleteUserBoardTemplate, fetchUserBoardTemplates } from '../lib/api/boardTemplate';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { Skeleton, SkeletonRegion } from '../components/Skeleton';
import TemplateDialog from '../components/templates/TemplateDialog';
import TemplateThumb from '../components/templates/TemplateThumb';
import { getErrorMessage } from '../lib/errorMessage';
import { logError } from '../lib/logError';
import { cardCount, fromBuiltin, fromUser, matchesTemplate, MINE_CATEGORY, type TemplateItem } from '../lib/templates';

const CHIP = 'rounded-full border px-3 py-1 text-sm transition-colors';
const CHIP_ON = 'border-primary bg-primary-soft font-medium text-primary-ink';
const CHIP_OFF = 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700/50';

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { upsertBoard } = useBoards();
  const { workspaces, currentWorkspaceId } = useWorkspaces();
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('');
  const [builtin, setBuiltin] = useState<TemplateItem[]>([]);
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [mine, setMine] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [opened, setOpened] = useState<TemplateItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TemplateItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchTemplates()
      .then((res) => {
        setBuiltin(res.templates.map(fromBuiltin));
        setCategories(res.categories);
      })
      .catch((err) => setError(getErrorMessage(err, 'Không tải được mẫu.')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!targetWorkspaceId && currentWorkspaceId) setTargetWorkspaceId(currentWorkspaceId);
  }, [targetWorkspaceId, currentWorkspaceId]);

  const wsId = targetWorkspaceId || currentWorkspaceId;
  const loadMine = useCallback(() => {
    if (!wsId) return;
    fetchUserBoardTemplates(wsId)
      .then((list) => setMine(list.map(fromUser)))
      .catch(logError('TemplatesPage: tai mau cua ban'));
  }, [wsId]);
  useEffect(() => {
    loadMine();
  }, [loadMine]);

  // Khong gian doi -> mau "cua ban" doi theo; dang chon nhom "Cua ban" ma het mau thi ve "Tat ca"
  useEffect(() => {
    if (category === MINE_CATEGORY && mine.length === 0) setCategory('all');
  }, [category, mine.length]);

  const sections = useMemo(() => {
    const matching = (items: TemplateItem[]) => items.filter((t) => matchesTemplate(t, query));
    const out: { id: string; name: string; items: TemplateItem[] }[] = [];
    if (category === 'all' || category === MINE_CATEGORY) {
      const items = matching(mine);
      if (items.length > 0) out.push({ id: MINE_CATEGORY, name: 'Mẫu của bạn', items });
    }
    if (category !== MINE_CATEGORY) {
      for (const c of categories) {
        if (category !== 'all' && category !== c.id) continue;
        const items = matching(builtin.filter((t) => t.category === c.id));
        if (items.length > 0) out.push({ id: c.id, name: c.name, items });
      }
    }
    return out;
  }, [builtin, categories, mine, query, category]);

  async function create(t: TemplateItem, name?: string) {
    if (!wsId) {
      setError('Hãy chọn không gian làm việc.');
      return;
    }
    setCreating(t.key);
    setError(null);
    try {
      const board = t.source === 'builtin' ? await createBoardFromTemplate(t.id, wsId, name) : await createBoardFromUserTemplate(wsId, t.id, name);
      upsertBoard(board);
      navigate(`/boards/${board.id}`);
    } catch (err) {
      setError(getErrorMessage(err, 'Không tạo được bảng từ mẫu.'));
      setCreating(null);
    }
  }

  async function confirmDelete() {
    const t = pendingDelete;
    if (!t) return;
    setDeleting(true);
    try {
      await deleteUserBoardTemplate(t.id);
      setMine((cur) => cur.filter((x) => x.key !== t.key));
      setPendingDelete(null);
    } catch (err) {
      setPendingDelete(null);
      setError(getErrorMessage(err, 'Không xoá được mẫu.'));
    } finally {
      setDeleting(false);
    }
  }

  const filtering = query.trim() !== '' || category !== 'all';
  const closeDialog = useCallback(() => {
    setOpened(null);
    setError(null);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Mẫu bảng</h1>
        {workspaces.length > 1 && (
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            Tạo trong
            <select
              value={wsId ?? ''}
              onChange={(e) => setTargetWorkspaceId(e.target.value)}
              className="h-9 max-w-[16rem] rounded-lg border border-slate-300 bg-white px-2 text-sm focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!loading && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Tìm mẫu</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm mẫu"
              className="h-9 w-56 rounded-lg border border-slate-300 bg-white pl-8 pr-2 text-sm focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <div role="group" aria-label="Nhóm mẫu" className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')} className={`${CHIP} ${category === 'all' ? CHIP_ON : CHIP_OFF}`}>
              Tất cả
            </button>
            {mine.length > 0 && (
              <button
                type="button"
                aria-pressed={category === MINE_CATEGORY}
                onClick={() => setCategory(MINE_CATEGORY)}
                className={`${CHIP} ${category === MINE_CATEGORY ? CHIP_ON : CHIP_OFF}`}
              >
                Của bạn
              </button>
            )}
            {categories.map((c) => (
              <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)} className={`${CHIP} ${category === c.id ? CHIP_ON : CHIP_OFF}`}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && !opened && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <SkeletonRegion label="Đang tải mẫu…" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </SkeletonRegion>
      ) : sections.length === 0 ? (
        <EmptyState
          icon="boards"
          compact
          title="Không có mẫu nào khớp."
          action={
            filtering ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                }}
                className="text-sm font-medium text-primary-ink hover:underline"
              >
                Bỏ bộ lọc
              </button>
            ) : undefined
          }
        />
      ) : (
        sections.map((s) => (
          <section key={s.id} aria-label={s.name}>
            <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {s.name} <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">{s.items.length}</span>
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {s.items.map((t) => (
                <article
                  key={t.key}
                  className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
                >
                  <button
                    type="button"
                    onClick={() => setOpened(t)}
                    aria-label={`Xem mẫu ${t.name}`}
                    className="flex flex-1 flex-col text-left focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <TemplateThumb color={t.color} lists={t.lists} />
                    <span className="flex flex-1 flex-col gap-1 p-3.5">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.name}</span>
                      <span className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                        {t.description || `Do ${t.createdBy} lưu từ một bảng có sẵn.`}
                      </span>
                      <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {t.lists.length} cột · {cardCount(t)} thẻ ví dụ
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2.5 dark:border-slate-700">
                    <button
                      type="button"
                      disabled={creating !== null}
                      onClick={() => void create(t)}
                      aria-label={`Dùng mẫu ${t.name}`}
                      className="h-8 flex-1 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary-ink disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
                    >
                      {creating === t.key ? 'Đang tạo…' : 'Dùng mẫu'}
                    </button>
                    {t.source === 'user' && (
                      <button
                        type="button"
                        onClick={() => setPendingDelete(t)}
                        aria-label={`Xoá mẫu ${t.name}`}
                        className="h-8 rounded-lg px-2.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                      >
                        Xoá
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}

      {opened && (
        <TemplateDialog
          template={opened}
          workspaces={workspaces}
          workspaceId={wsId ?? ''}
          onWorkspaceChange={setTargetWorkspaceId}
          busy={creating === opened.key}
          error={error}
          onCreate={(name) => void create(opened, name)}
          onClose={closeDialog}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Xoá mẫu này?"
        message={pendingDelete ? `Mẫu “${pendingDelete.name}” sẽ bị xoá khỏi không gian. Các bảng đã tạo từ mẫu không bị ảnh hưởng.` : undefined}
        confirmLabel="Xoá mẫu"
        danger
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
