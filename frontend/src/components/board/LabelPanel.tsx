import { useState } from 'react';
import {
  createBoardLabel,
  deleteLabel,
  updateLabel,
} from '../../lib/api/card';
import { getErrorMessage } from '../../lib/errorMessage';
import type { Label } from '../../types/card';

// Bang mau nhan (giong bo mau moi cua Trello)
const LABEL_COLORS = [
  '#4bce97',
  '#f5cd47',
  '#fea362',
  '#f87168',
  '#9f8fef',
  '#579dff',
  '#6cc3e0',
  '#94c748',
  '#e774bb',
  '#8590a2',
];

function ColorGrid({
  value,
  onPick,
}: {
  value: string;
  onPick: (c: string) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {LABEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Màu ${c}`}
          aria-pressed={value === c}
          onClick={() => onPick(c)}
          className="grid h-7 place-items-center rounded"
          style={{ backgroundColor: c }}
        >
          {value === c && (
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}

interface Props {
  boardId: string;
  labels: Label[];
  cardLabelIds: Set<string>;
  onToggle: (labelId: string, attached: boolean) => void;
  onLabelsChanged: () => void;
}

export default function LabelPanel({
  boardId,
  labels,
  cardLabelIds,
  onToggle,
  onLabelsChanged,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState(LABEL_COLORS[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onLabelsChanged();
      setEditing(null);
      setCreating(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Thao tác nhãn thất bại.'));
    } finally {
      setBusy(false);
    }
  }

  const startEdit = (l: Label) => {
    setCreating(false);
    setEditing(l.id);
    setDraftName(l.name);
    setDraftColor(l.color);
  };
  const startCreate = () => {
    setEditing(null);
    setCreating(true);
    setDraftName('');
    setDraftColor(LABEL_COLORS[0]!);
  };

  return (
    <div className="absolute left-7 top-10 z-10 w-72 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 shadow-xl">
      <p className="mb-1 px-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Nhãn</p>
      {error && <p className="mb-1 px-1 text-xs text-red-600">{error}</p>}

      <div className="flex flex-col gap-1">
        {labels.map((l) =>
          editing === l.id ? (
            <div key={l.id} className="rounded-lg bg-slate-50 dark:bg-slate-700 p-2">
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={50}
                placeholder="Tên nhãn (tuỳ chọn)"
                className="mb-2 w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm focus:border-primary focus:outline-none"
              />
              <ColorGrid value={draftColor} onPick={setDraftColor} />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      updateLabel(l.id, {
                        name: draftName.trim(),
                        color: draftColor,
                      })
                    )
                  }
                  className="flex-1 rounded bg-primary py-1 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                >
                  Lưu
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => deleteLabel(l.id))}
                  className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Xoá
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded px-2 py-1 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Huỷ
                </button>
              </div>
            </div>
          ) : (
            <div key={l.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onToggle(l.id, cardLabelIds.has(l.id))}
                className="flex flex-1 items-center gap-2 rounded px-1 py-1 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <span
                  className="grid h-7 flex-1 place-items-center rounded px-2 text-left text-xs font-medium text-white"
                  style={{ backgroundColor: l.color }}
                >
                  <span className="w-full truncate">{l.name}</span>
                </span>
                {cardLabelIds.has(l.id) && (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={() => startEdit(l)}
                title="Sửa nhãn"
                className="shrink-0 rounded p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
                </svg>
              </button>
            </div>
          )
        )}
      </div>

      {creating ? (
        <div className="mt-1 rounded-lg bg-slate-50 dark:bg-slate-700 p-2">
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            maxLength={50}
            placeholder="Tên nhãn (tuỳ chọn)"
            className="mb-2 w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm focus:border-primary focus:outline-none"
          />
          <ColorGrid value={draftColor} onPick={setDraftColor} />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  createBoardLabel(boardId, {
                    name: draftName.trim(),
                    color: draftColor,
                  })
                )
              }
              className="flex-1 rounded bg-primary py-1 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              Tạo nhãn
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded px-2 py-1 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              Huỷ
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={startCreate}
          className="mt-1 w-full rounded bg-slate-100 dark:bg-slate-700 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
        >
          + Tạo nhãn mới
        </button>
      )}
    </div>
  );
}
