import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import AuthShell, { authFieldClass } from '../components/auth/AuthShell';
import { forgotPassword } from '../lib/api/auth';
import { getErrorMessage } from '../lib/errorMessage';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { previewUrl } = await forgotPassword(email);
      setPreviewUrl(previewUrl ?? null);
      setSent(true);
    } catch (err) {
      setError(getErrorMessage(err, 'Không gửi được yêu cầu. Vui lòng thử lại.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Quên mật khẩu"
      subtitle="Nhập email của bạn, chúng tôi sẽ gửi liên kết đặt lại mật khẩu."
      footer={
        <>
          Nhớ ra rồi?{' '}
          <Link to="/login" className="font-semibold text-primary-ink hover:underline">
            Đăng nhập
          </Link>
        </>
      }
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-800">
            Nếu <span className="font-semibold">{email}</span> đã đăng ký, một email
            hướng dẫn đặt lại mật khẩu vừa được gửi đi. Vui lòng kiểm tra hộp thư
            (cả mục spam).
          </div>

          {previewUrl && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span className="font-semibold">Chế độ phát triển:</span> mail được
              gửi qua hộp thư ảo.{' '}
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline"
              >
                Mở email để xem liên kết
              </a>
            </div>
          )}

          <Link
            to="/login"
            className="rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-primary-hover)]"
          >
            Về trang đăng nhập
          </Link>
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={authFieldClass}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-1 rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-primary-hover)] disabled:opacity-60"
            >
              {isSubmitting ? 'Đang gửi...' : 'Gửi liên kết đặt lại'}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
