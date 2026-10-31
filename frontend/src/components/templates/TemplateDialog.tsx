import { useEffect, useId, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { STATUS_META } from '../../lib/cardStatus';
import { cardCount, type TemplateItem } from '../../lib/templates';

interface Props {
  template: TemplateItem;
  workspaces: { id: string; name: string }[];
  workspaceId: string;
  onWorkspaceChange: (id: string) => void;
  busy: boolean;
  error: string | null;
  onCreate: (name: string) => void;
  onClose: () => void;
}

/** Xem đầy đủ cột và thẻ ví dụ của một mẫu, đặt tên bảng rồi tạo. */
export default function TemplateDialog({ template, workspaces, workspaceId, onWorkspaceChange, busy, error, onCreate, onClose }: Props) {
  const [name, setName] = useState(template.name);
  const titleId = useId();
  const nameId = useId();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [busy, onClose]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    onCreate(name.trim() || template.name);
  }

  return createPortal(
    <div
      className="tf-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border-t-4 bg-white shadow-2xl dark:bg-slate-800 dark:text-slate-100"
        style={{ borderTopColor: template.color }}
      >
        <div className="flex items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {template.name}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {template.description || (template.createdBy ? `Mẫu do ${template.createdBy} lưu` : '')}
              {template.description || template.createdBy ? ' · ' : ''}
              {template.lists.length} cột, {cardCount(template)} thẻ ví dụ
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Đóng"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <div className="tf-scroll flex items-start gap-2 overflow-x-auto rounded-lg p-3" style={{ backgroundColor: template.color }}>
            {template.lists.map((l) => (
              <section key={l.name} aria-label={`Cột ${l.name}`} className="w-44 shrink-0 rounded-lg bg-slate-100 p-2 dark:bg-slate-900">
                <h3 className="flex items-center gap-1.5 px-1 pb-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${l.status ? STATUS_META[l.status].dot : 'bg-slate-300 dark:bg-slate-600'}`} />
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  <span className="font-normal text-slate-400">{l.cards.length}</span>
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {l.cards.map((c) => (
                    <li key={c} className="rounded-md bg-white px-2 py-1.5 text-xs text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100">
                      {c}
                    </li>
                  ))}
                  {l.cards.length === 0 && <li className="px-1 pb-1 text-xs text-slate-400">Chưa có thẻ</li>}
                </ul>
              </section>
            ))}
          </div>

          {template.labels.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span>Nhãn có sẵn:</span>
              {template.labels.map((l) => (
                <span key={l.name} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
                  {l.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor={nameId} className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Tên bảng
            </label>
            <input
              id={nameId}
              autoFocus
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-900"
            />
          </div>
          {workspaces.length > 1 && (
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              <span className="mb-1 block">Không gian</span>
              <select
                value={workspaceId}
                onChange={(e) => onWorkspaceChange(e.target.value)}
                className="h-9 max-w-[14rem] rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-900"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-9 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? 'Đang tạo…' : 'Tạo bảng'}
            </button>
          </div>
          {error && (
            <p role="alert" className="basis-full text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
      </form>
    </div>,
    document.body
  );
}
