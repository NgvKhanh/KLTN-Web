import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthShell from '../components/auth/AuthShell';
import PasswordField from '../components/auth/PasswordField';
import { resetPassword } from '../lib/api/auth';
import { getErrorMessage } from '../lib/errorMessage';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }
    if (password !== confirm) {
      setError('Hai ô mật khẩu không khớp.');
      return;
    }

    setIsSubmitting(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          'Không đặt lại được mật khẩu. Liên kết có thể đã hết hạn.'
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const footer = (
    <>
      Nhớ mật khẩu?{' '}
      <Link to="/login" className="font-semibold text-primary-ink hover:underline">
        Đăng nhập
      </Link>
    </>
  );

  if (!token) {
    return (
      <AuthShell
        title="Liên kết không hợp lệ"
        subtitle="Thiếu mã đặt lại mật khẩu trong đường dẫn."
        footer={footer}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
            Đường dẫn không chứa mã hợp lệ. Hãy yêu cầu gửi lại email đặt lại mật
            khẩu.
          </div>
          <Link
            to="/forgot-password"
            className="rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-primary-hover)]"
          >
            Yêu cầu liên kết mới
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Đặt lại mật khẩu"
      subtitle="Nhập mật khẩu mới cho tài khoản của bạn."
      footer={footer}
    >
      {done ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-800">
            Đã đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu
            mới.
          </div>
          <Link
            to="/login"
            className="rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-primary-hover)]"
          >
            Đăng nhập
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
            <PasswordField
              label="Mật khẩu mới"
              value={password}
              onChange={setPassword}
              minLength={6}
              autoComplete="new-password"
            />
            <PasswordField
              label="Nhập lại mật khẩu mới"
              value={confirm}
              onChange={setConfirm}
              minLength={6}
              autoComplete="new-password"
            />

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-1 rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-primary-hover)] disabled:opacity-60"
            >
              {isSubmitting ? 'Đang lưu...' : 'Đặt lại mật khẩu'}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
