import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardMember } from '../../../types/board';
import Avatar from '../../Avatar';

interface Props {
  boardMembers: BoardMember[];
  placeholder: string;
  // Noi dung co san (vd "@Ten " khi tra loi)
  initialText?: string;
  autoFocus?: boolean;
  // Tra ve true khi gui thanh cong -> moi xoa o nhap (gui loi thi giu lai chu da go)
  onSubmit: (text: string) => Promise<boolean>;
  // Co thi hien nut "Huỷ" va Esc huy o nhap (khong dong ca the)
  onCancel?: () => void;
  ariaLabel?: string;
}

/** O nhap binh luan / tra loi, co goi y "@nhac ten" khi dang go @... o cuoi. */
export default function CommentComposer({
  boardMembers,
  placeholder,
  initialText = '',
  autoFocus = false,
  onSubmit,
  onCancel,
  ariaLabel,
}: Props) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mo san (vd o tra loi co "@Ten "): focus va dua con tro ve cuoi thay vi dau dong
  useEffect(() => {
    if (!autoFocus || !inputRef.current) return;
    const el = inputRef.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chi chay 1 lan luc mo o nhap
  }, []);

  const mentionQuery = useMemo(() => {
    const m = /@([^@\s]*)$/.exec(text);
    return m ? m[1]!.toLowerCase() : null;
  }, [text]);
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    return boardMembers
      .filter((m) => m.user.name.toLowerCase().includes(mentionQuery))
      .slice(0, 6);
  }, [mentionQuery, boardMembers]);

  async function submit() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      if (await onSubmit(t)) setText('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="relative flex gap-2"
    >
      <input
        ref={inputRef}
        value={text}
        // Khop gioi han cua server (commentSchema.text toi da 5000 ky tu)
        maxLength={5000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onCancel) {
            // Chi huy o tra loi, khong de su kien len toi trinh nghe Esc dong ca the
            e.stopPropagation();
            onCancel();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        // Dang gui: khoa sua (readOnly giu nguyen con tro, khac disabled lam mat focus)
        readOnly={busy}
        className={"min-w-0 flex-1 rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm focus:border-primary focus:outline-none " + (busy ? 'opacity-60' : '')}
      />
      {text.trim() && (
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-lg bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
        >
          Gửi
        </button>
      )}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-lg px-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          Huỷ
        </button>
      )}
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div className="tf-menu-in absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-1 shadow-xl">
          {mentionMatches.map((m) => (
            <button
              key={m.userId}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setText((c) => c.replace(/@[^@\s]*$/, `@${m.user.name} `))}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <Avatar
                id={m.userId}
                name={m.user.name}
                avatarUrl={m.user.avatarUrl}
                className="h-6 w-6 text-[10px]"
              />
              <span className="flex-1 truncate">{m.user.name}</span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
