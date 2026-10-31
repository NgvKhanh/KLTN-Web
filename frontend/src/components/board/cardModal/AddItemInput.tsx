import { useState } from 'react';

/** O nhap nhanh de them 1 muc vao checklist (bam "+ Thêm mục" moi hien input). */
export function AddItemInput({
  onAdd,
}: {
  onAdd: (content: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 rounded px-2 py-1 text-left text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
      >
        + Thêm mục
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = v.trim();
        if (!t) return;
        setV('');
        void onAdd(t);
      }}
      className="mt-1 flex gap-2"
    >
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => !v.trim() && setOpen(false)}
        maxLength={500}
        placeholder="Thêm một mục..."
        className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm focus:border-primary focus:outline-none"
      />
      <button
        type="submit"
        className="rounded bg-primary px-3 text-sm font-medium text-white"
      >
        Thêm
      </button>
    </form>
  );
}
