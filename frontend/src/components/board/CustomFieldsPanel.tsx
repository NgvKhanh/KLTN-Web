import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  addFieldOption,
  createCustomField,
  deleteCustomField,
  deleteFieldOption,
  fetchBoardCustomFields,
} from '../../lib/api/customField';
import { getErrorMessage } from '../../lib/errorMessage';
import type { CustomField, CustomFieldType } from '../../types/customField';
import { SkeletonRegion, SkeletonRows } from '../Skeleton';

const TYPE_LABEL: Record<CustomFieldType, string> = {
  TEXT: 'Văn bản',
  NUMBER: 'Số',
  DATE: 'Ngày',
  CHECKBOX: 'Hộp kiểm',
  DROPDOWN: 'Danh sách chọn',
};

interface Props {
  boardId: string;
  onClose: () => void;
  onChanged: () => void;
}

export default function CustomFieldsPanel({ boardId, onClose, onChanged }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldType>('TEXT');
  const [draftOptions, setDraftOptions] = useState<string[]>(['']);
  const [newOptionValue, setNewOptionValue] = useState<Record<string, string>>({});

  function load() {
    setLoading(true);
    fetchBoardCustomFields(boardId)
      .then(setFields)
      .catch((err) => setError(getErrorMessage(err, 'Không tải được danh sách trường.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-fields-trigger]')) {
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

  async function submitCreate() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const options =
        type === 'DROPDOWN'
          ? draftOptions.map((v) => v.trim()).filter(Boolean).map((value) => ({ value }))
          : undefined;
      await createCustomField(boardId, { name: trimmed, type, options });
      setName('');
      setType('TEXT');
      setDraftOptions(['']);
      load();
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, 'Không tạo được trường.'));
    } finally {
      setBusy(false);
    }
  }

  async function removeField(fieldId: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteCustomField(fieldId);
      load();
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, 'Không xoá được trường.'));
    } finally {
      setBusy(false);
    }
  }

  async function addOption(fieldId: string) {
    const value = (newOptionValue[fieldId] ?? '').trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await addFieldOption(fieldId, { value });
      setNewOptionValue((cur) => ({ ...cur, [fieldId]: '' }));
      load();
    } catch (err) {
      setError(getErrorMessage(err, 'Không thêm được lựa chọn.'));
    } finally {
      setBusy(false);
    }
  }

  async function removeOption(optionId: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteFieldOption(optionId);
      load();
    } catch (err) {
      setError(getErrorMessage(err, 'Không xoá được lựa chọn.'));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      ref={ref}
      className="tf-menu-in fixed right-3 top-14 z-50 max-h-[80vh] w-96 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
    >
      <p className="mb-2 text-center text-sm font-semibold">Trường tùy chỉnh</p>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {loading ? (
        <SkeletonRegion label="Đang tải…" className="py-3">
          <SkeletonRows rows={3} />
        </SkeletonRegion>
      ) : fields.length === 0 ? (
        <p className="mb-2 text-center text-sm text-slate-500 dark:text-slate-400">
          Bảng chưa có trường tùy chỉnh nào.
        </p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {fields.map((f) => (
            <li key={f.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{f.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{TYPE_LABEL[f.type]}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeField(f.id)}
                  className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10"
                >
                  Xoá
                </button>
              </div>

              {f.type === 'DROPDOWN' && (
                <div className="mt-2">
                  <div className="flex flex-wrap gap-1">
                    {f.options.map((o) => (
                      <span
                        key={o.id}
                        className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-700"
                      >
                        {o.value}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => removeOption(o.id)}
                          aria-label={`Xoá lựa chọn ${o.value}`}
                          className="text-slate-400 hover:text-red-600"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    <input
                      value={newOptionValue[f.id] ?? ''}
                      onChange={(e) =>
                        setNewOptionValue((cur) => ({ ...cur, [f.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void addOption(f.id);
                        }
                      }}
                      placeholder="Thêm lựa chọn..."
                      className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      disabled={busy || !(newOptionValue[f.id] ?? '').trim()}
                      onClick={() => void addOption(f.id)}
                      className="rounded bg-slate-100 px-2 py-1 text-xs font-medium hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
                    >
                      Thêm
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
        <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
          Thêm trường mới
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tên trường (vd. Ưu tiên, Khách hàng...)"
          className="mb-1.5 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-900"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as CustomFieldType)}
          className="mb-1.5 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-900"
        >
          {(Object.keys(TYPE_LABEL) as CustomFieldType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>

        {type === 'DROPDOWN' && (
          <div className="mb-1.5 flex flex-col gap-1">
            {draftOptions.map((v, i) => (
              <div key={i} className="flex gap-1">
                <input
                  value={v}
                  onChange={(e) =>
                    setDraftOptions((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))
                  }
                  placeholder={`Lựa chọn ${i + 1}`}
                  className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-900"
                />
                {draftOptions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setDraftOptions((cur) => cur.filter((_, j) => j !== i))}
                    className="rounded px-1.5 text-xs text-slate-400 hover:text-red-600"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setDraftOptions((cur) => [...cur, ''])}
              className="self-start text-xs font-medium text-primary-ink hover:underline"
            >
              + Thêm lựa chọn
            </button>
          </div>
        )}

        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void submitCreate()}
          className="w-full rounded-lg bg-primary py-1.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          Thêm trường
        </button>
      </div>
    </div>,
    document.body
  );
}
