import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { resendVerification } from '../lib/api/auth';
import { getErrorMessage } from '../lib/errorMessage';

const DISMISS_KEY = 'taskflow_hide_verify_banner';

// Thanh nhac xac minh email - hien khi da dang nhap nhung chua xac minh.
// Khong chan thao tac, co the tam an trong phien lam viec.
export default function EmailVerifyBanner() {
  const { user } = useAuth();

  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user || user.emailVerifiedAt || hidden) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* bo qua */
    }
    setHidden(true);
  }

  async function resend() {
    setSending(true);
    setError(null);
    try {
      const { previewUrl } = await resendVerification();
      setPreviewUrl(previewUrl ?? null);
      setSent(true);
    } catch (err) {
      setError(getErrorMessage(err, 'Không gửi lại được email.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4h16v16H4zM4 7l8 6 8-6" />
        </svg>

        {sent ? (
          <span className="flex-1">
            Đã gửi email xác minh tới <span className="font-semibold">{user.email}</span>. Kiểm tra hộp thư nhé.
            {previewUrl && (
              <>
                {' '}
                <a href={previewUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
                  Mở email (chế độ dev)
                </a>
              </>
            )}
          </span>
        ) : (
          <span className="flex-1">
            Email <span className="font-semibold">{user.email}</span> chưa được xác minh.
            {error && <span className="ml-2 text-red-600">{error}</span>}
          </span>
        )}

        {!sent && (
          <button
            type="button"
            onClick={resend}
            disabled={sending}
            className="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
          >
            {sending ? 'Đang gửi...' : 'Gửi lại email xác minh'}
          </button>
        )}

        <button
          type="button"
          onClick={dismiss}
          aria-label="Ẩn thông báo"
          className="rounded p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
