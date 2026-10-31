import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { getErrorMessage } from '../../lib/errorMessage';

// Khop gioi han cua server (createCardSchema.title)
const MAX_TITLE = 500;

interface Props {
  onAdd: (title: string) => Promise<void>;
  // Cho phep dieu khien tu ben ngoai (vd menu "..." bam "Them the")
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function AddCardForm({ onAdd, open, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setIsOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setIsOpen(false);
    setTitle('');
    setError(null);
  }

  async function submit() {
    const value = title.trim();
    if (!value) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onAdd(value);
      setTitle(''); // giu form mo de them nhieu the lien tiep
    } catch (err) {
      // Lay thong diep cua server (vd "Noi dung the qua dai"), khong hien
      // "Request failed with status code 400" cua axios
      setError(getErrorMessage(err, 'Không thêm được thẻ.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') close();
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        data-add-card
        onClick={() => setIsOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10"
      >
        <span className="text-base leading-none">+</span> Thêm thẻ
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <textarea
        autoFocus
        rows={2}
        value={title}
        maxLength={MAX_TITLE}
        disabled={isSubmitting}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Nhập nội dung cho thẻ này..."
        className="w-full resize-none rounded-lg border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting || !title.trim()}
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {isSubmitting ? 'Đang thêm...' : 'Thêm thẻ'}
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
