import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createAutomationRule,
  deleteAutomationRule,
  fetchAutomationRules,
  updateAutomationRule,
  type AutomationActionInput,
  type AutomationActionType,
  type AutomationRule,
  type AutomationTriggerType,
} from '../../lib/api/automation';
import { fetchBoardLabels } from '../../lib/api/card';
import { fetchBoardMembers } from '../../lib/api/board';
import { fetchBoardLists } from '../../lib/api/list';
import { getErrorMessage } from '../../lib/errorMessage';
import { logError } from '../../lib/logError';
import type { BoardMember } from '../../types/board';
import type { Label } from '../../types/card';
import type { BoardList } from '../../types/list';
import { SkeletonRegion, SkeletonRows } from '../Skeleton';

interface Props {
  boardId: string;
  onClose: () => void;
}

const ACTION_TYPE_LABEL: Record<AutomationActionType, string> = {
  SET_DONE: 'Đánh dấu hoàn thành',
  ADD_LABEL: 'Gắn nhãn',
  ASSIGN_MEMBER: 'Gán thành viên',
};

function emptyAction(): AutomationActionInput {
  return { type: 'SET_DONE', boolValue: true };
}

export default function AutomationPanel({ boardId, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [lists, setLists] = useState<BoardList[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>('CARD_CREATED');
  const [triggerListId, setTriggerListId] = useState('');
  const [actions, setActions] = useState<AutomationActionInput[]>([emptyAction()]);

  function load() {
    setLoading(true);
    Promise.all([
      fetchAutomationRules(boardId),
      fetchBoardLists(boardId),
      fetchBoardLabels(boardId),
      fetchBoardMembers(boardId),
    ])
      .then(([r, l, lb, m]) => {
        setRules(r);
        setLists(l);
        setLabels(lb);
        setMembers(m);
      })
      .catch((err) => setError(getErrorMessage(err, 'Không tải được tự động hoá.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-automation-trigger]')) {
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

  function updateActionAt(i: number, patch: Partial<AutomationActionInput>) {
    setActions((cur) => cur.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  function changeActionType(i: number, type: AutomationActionType) {
    const base: AutomationActionInput = { type };
    if (type === 'SET_DONE') base.boolValue = true;
    if (type === 'ADD_LABEL') base.labelId = labels[0]?.id;
    if (type === 'ASSIGN_MEMBER') base.userId = members[0]?.userId;
    setActions((cur) => cur.map((a, idx) => (idx === i ? base : a)));
  }

  async function submitCreate() {
    if (!name.trim() || busy) return;
    if (triggerType === 'CARD_MOVED_TO_LIST' && !triggerListId) {
      setError('Chọn danh sách đích cho điều kiện "chuyển vào danh sách".');
      return;
    }
    for (const a of actions) {
      if (a.type === 'ADD_LABEL' && !a.labelId) {
        setError('Bảng chưa có nhãn nào để chọn.');
        return;
      }
      if (a.type === 'ASSIGN_MEMBER' && !a.userId) {
        setError('Bảng chưa có thành viên nào để chọn.');
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      await createAutomationRule(boardId, {
        name: name.trim(),
        triggerType,
        triggerListId: triggerType === 'CARD_MOVED_TO_LIST' ? triggerListId : undefined,
        actions,
      });
      setName('');
      setTriggerListId('');
      setActions([emptyAction()]);
      load();
    } catch (err) {
      setError(getErrorMessage(err, 'Không tạo được luật.'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(rule: AutomationRule) {
    const prev = rules;
    setRules((cur) =>
      cur.map((r) => (r.id === rule.id ? { ...r, isEnabled: !r.isEnabled } : r))
    );
    try {
      await updateAutomationRule(rule.id, { isEnabled: !rule.isEnabled });
    } catch (err) {
      setRules(prev);
      logError('AutomationPanel: doi trang thai bat/tat')(err);
    }
  }

  async function remove(rule: AutomationRule) {
    const prev = rules;
    setRules((cur) => cur.filter((r) => r.id !== rule.id));
    try {
      await deleteAutomationRule(rule.id);
    } catch (err) {
      setRules(prev);
      setError(getErrorMessage(err, 'Không xoá được luật.'));
    }
  }

  function listName(id: string | null): string {
    if (!id) return 'bất kỳ danh sách nào';
    return lists.find((l) => l.id === id)?.name ?? '(danh sách đã xoá)';
  }

  function describeTrigger(rule: AutomationRule): string {
    if (rule.triggerType === 'CARD_CREATED') {
      return `Khi thẻ được tạo trong ${listName(rule.triggerListId)}`;
    }
    return `Khi thẻ được chuyển vào "${listName(rule.triggerListId)}"`;
  }

  function describeAction(a: AutomationRule['actions'][number]): string {
    if (a.type === 'SET_DONE') return a.boolValue === false ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành';
    if (a.type === 'ADD_LABEL') {
      const l = labels.find((x) => x.id === a.labelId);
      return `Gắn nhãn "${l?.name || l?.color || '(đã xoá)'}"`;
    }
    const m = members.find((x) => x.userId === a.userId);
    return `Gán thành viên ${m?.user.name ?? '(đã rời bảng)'}`;
  }

  const field =
    'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-900';

  return createPortal(
    <div
      ref={ref}
      className="tf-menu-in fixed right-3 top-14 z-50 max-h-[80vh] w-96 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
    >
      <p className="mb-2 text-center text-sm font-semibold">Tự động hoá</p>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {loading ? (
        <SkeletonRegion label="Đang tải…" className="py-3">
          <SkeletonRows rows={3} />
        </SkeletonRegion>
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tên luật, vd: Vào Xong thì đóng thẻ"
              className={field}
            />

            <div className="flex gap-2">
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as AutomationTriggerType)}
                className={field}
              >
                <option value="CARD_CREATED">Khi thẻ được tạo</option>
                <option value="CARD_MOVED_TO_LIST">Khi thẻ chuyển vào danh sách</option>
              </select>
            </div>

            {(triggerType === 'CARD_MOVED_TO_LIST' || lists.length > 0) && (
              <select
                value={triggerListId}
                onChange={(e) => setTriggerListId(e.target.value)}
                className={field}
              >
                <option value="">
                  {triggerType === 'CARD_CREATED' ? 'Bất kỳ danh sách nào' : 'Chọn danh sách...'}
                </option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}

            <p className="mt-1 text-xs font-medium text-slate-500">Hành động</p>
            {actions.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <select
                  value={a.type}
                  onChange={(e) => changeActionType(i, e.target.value as AutomationActionType)}
                  className={field}
                >
                  {(Object.keys(ACTION_TYPE_LABEL) as AutomationActionType[]).map((t) => (
                    <option key={t} value={t}>
                      {ACTION_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>

                {a.type === 'SET_DONE' && (
                  <select
                    value={a.boolValue === false ? 'false' : 'true'}
                    onChange={(e) => updateActionAt(i, { boolValue: e.target.value === 'true' })}
                    className={field + ' max-w-[7.5rem]'}
                  >
                    <option value="true">Xong</option>
                    <option value="false">Chưa xong</option>
                  </select>
                )}
                {a.type === 'ADD_LABEL' && (
                  <select
                    value={a.labelId ?? ''}
                    onChange={(e) => updateActionAt(i, { labelId: e.target.value })}
                    className={field + ' max-w-[7.5rem]'}
                  >
                    {labels.length === 0 && <option value="">(chưa có nhãn)</option>}
                    {labels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name || l.color}
                      </option>
                    ))}
                  </select>
                )}
                {a.type === 'ASSIGN_MEMBER' && (
                  <select
                    value={a.userId ?? ''}
                    onChange={(e) => updateActionAt(i, { userId: e.target.value })}
                    className={field + ' max-w-[7.5rem]'}
                  >
                    {members.length === 0 && <option value="">(chưa có ai)</option>}
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.user.name}
                      </option>
                    ))}
                  </select>
                )}

                {actions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setActions((cur) => cur.filter((_, idx) => idx !== i))}
                    aria-label="Bỏ hành động này"
                    className="shrink-0 text-slate-400 hover:text-red-600"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {actions.length < 5 && (
              <button
                type="button"
                onClick={() => setActions((cur) => [...cur, emptyAction()])}
                className="self-start text-xs font-medium text-primary-ink hover:underline"
              >
                + Thêm hành động
              </button>
            )}

            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={() => void submitCreate()}
              className="w-full rounded-lg bg-primary py-1.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              Tạo luật
            </button>
          </div>

          {rules.length === 0 ? (
            <p className="text-center text-sm text-slate-500 dark:text-slate-400">
              Bảng chưa có luật tự động hoá nào.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rules.map((r) => (
                <li key={r.id} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {describeTrigger(r)}
                      </p>
                      <p className="text-xs text-slate-400">
                        → {r.actions.map(describeAction).join(', ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={() => toggleEnabled(r)}
                        className="rounded px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        {r.isEnabled ? 'Đang bật' : 'Đang tắt'}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r)}
                        className="rounded px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                      >
                        Xoá
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>,
    document.body
  );
}
