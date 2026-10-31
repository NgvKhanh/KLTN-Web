import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { getErrorMessage } from '../../lib/errorMessage';

// Khop gioi han cua server (list.schema: ten toi da 100 ky tu)
const MAX_NAME = 100;

interface Props {
  onAdd: (name: string) => Promise<void>;
}

export default function AddListForm({ onAdd }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setIsOpen(false);
    setName('');
    setError(null);
  }

  async function submit() {
    const value = name.trim();
    if (!value) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onAdd(value);
      setName(''); // giu form mo de them nhieu danh sach lien tiep
    } catch (err) {
      setError(getErrorMessage(err, 'Không thêm được danh sách.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') close();
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex w-72 shrink-0 items-center gap-1.5 rounded-xl bg-white/30 px-3 py-2.5 text-sm font-medium text-white backdrop-blur-sm hover:bg-white/45"
      >
        <span className="text-base leading-none">+</span> Thêm danh sách
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-72 shrink-0 rounded-xl bg-[#f1f2f4] p-2 shadow-sm dark:bg-slate-800"
    >
      <input
        autoFocus
        value={name}
        maxLength={MAX_NAME}
        disabled={isSubmitting}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Nhập tên danh sách..."
        className="w-full rounded border border-primary bg-white px-2 py-1.5 text-sm focus:outline-none dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
      />
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting || !name.trim()}
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {isSubmitting ? 'Đang thêm...' : 'Thêm danh sách'}
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="Đóng"
          className="rounded p-1 text-slate-500 hover:bg-black/10 dark:text-slate-400 dark:hover:bg-white/10"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </form>
  );
}
