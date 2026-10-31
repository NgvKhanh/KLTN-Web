import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface ConflictRow {
  key: string;
  label: string;
  /** Ban cua minh (dang cho luu). */
  mine: string;
  /** Ban moi nhat tren the (nguoi khac vua luu). */
  theirs: string;
}

interface Props {
  rows: ConflictRow[];
  busy: boolean;
  /** Ghi de ban cua nguoi kia bang ban cua minh. */
  onOverwrite: () => void;
  /** Bo ban cua minh, lay ban moi nhat tren the. */
  onUseTheirs: () => void;
  /**
   * Quay lai o soan thao, giu nguyen noi dung minh dang viet (de tu gop tay).
   * Khong co -> khong hien nut; Esc dong hop thoai theo `onUseTheirs`.
   */
  onKeepEditing?: () => void;
}

/**
 * Hop thoai "nguoi khac vua sua cung cho": hien ban cua minh canh ban moi nhat
 * de chon giu ban nao. Khong co lua chon mac dinh pha huy: tieu diem va Esc di
 * vao nhanh KHONG mat noi dung dang viet khi co the.
 */
export default function CardConflictDialog({
  rows,
  busy,
  onOverwrite,
  onUseTheirs,
  onKeepEditing,
}: Props) {
  const dismiss = onKeepEditing ?? onUseTheirs;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismiss]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="card-conflict-title"
        className="w-[560px] max-w-full rounded-xl bg-white p-5 shadow-2xl dark:bg-slate-800"
      >
        <h3
          id="card-conflict-title"
          className="text-base font-semibold text-slate-900 dark:text-slate-100"
        >
          Thẻ này vừa được người khác sửa
        </h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Trong lúc bạn đang sửa, có người đã lưu thay đổi ở chỗ bạn sửa. Bạn muốn giữ bản
          nào?
        </p>

        <div className="mt-4 flex max-h-[50vh] flex-col gap-4 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.key}>
              <p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">
                {r.label}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-100 p-2 dark:bg-slate-700">
                  <p className="mb-1 text-xs text-slate-600 dark:text-slate-400">Bản của bạn</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-900 dark:text-slate-100">
                    {r.mine || '(trống)'}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-100 p-2 dark:bg-slate-700">
                  <p className="mb-1 text-xs text-slate-600 dark:text-slate-400">
                    Bản mới trên thẻ
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-900 dark:text-slate-100">
                    {r.theirs || '(trống)'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {onKeepEditing && (
            <button
              type="button"
              autoFocus
              disabled={busy}
              onClick={onKeepEditing}
              className="rounded px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Sửa tiếp
            </button>
          )}
          <button
            type="button"
            autoFocus={!onKeepEditing}
            disabled={busy}
            onClick={onUseTheirs}
            className="rounded bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-300 disabled:opacity-50 dark:bg-slate-600 dark:text-slate-100 dark:hover:bg-slate-500"
          >
            Dùng bản mới trên thẻ
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onOverwrite}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            Ghi đè bằng bản của tôi
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
