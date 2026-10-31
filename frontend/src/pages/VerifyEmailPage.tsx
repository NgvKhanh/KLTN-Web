import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthShell from '../components/auth/AuthShell';
import { useAuth } from '../context/AuthContext';
import { verifyEmail } from '../lib/api/auth';
import { getErrorMessage } from '../lib/errorMessage';

type Status = 'verifying' | 'success' | 'error';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, updateUser } = useAuth();

  const [status, setStatus] = useState<Status>('verifying');
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false); // tranh goi 2 lan (React StrictMode)

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!token) {
      setStatus('error');
      setError('Đường dẫn không chứa mã xác minh hợp lệ.');
      return;
    }

    verifyEmail(token)
      .then((updated) => {
        updateUser({ emailVerifiedAt: updated.emailVerifiedAt });
        setStatus('success');
      })
      .catch((err) => {
        setStatus('error');
        setError(
          getErrorMessage(
            err,
            'Không xác minh được email. Liên kết có thể đã hết hạn hoặc đã dùng.'
          )
        );
      });
  }, [token, updateUser]);

  const footer = user ? (
    <>
      Quay lại{' '}
      <Link to="/boards" className="font-semibold text-primary-ink hover:underline">
        Trang chủ
      </Link>
    </>
  ) : (
    <>
      Tiếp tục{' '}
      <Link to="/login" className="font-semibold text-primary-ink hover:underline">
        Đăng nhập
      </Link>
    </>
  );

  return (
    <AuthShell
      title="Xác minh email"
      subtitle="Đang kiểm tra liên kết xác minh của bạn."
      footer={footer}
    >
      {status === 'verifying' && (
        <p className="text-sm text-slate-500">Đang xác minh...</p>
      )}

      {status === 'success' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-800">
            Email của bạn đã được xác minh thành công. Cảm ơn bạn!
          </div>
          <Link
            to={user ? '/boards' : '/login'}
            className="rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-primary-hover)]"
          >
            {user ? 'Vào TaskFlow' : 'Đăng nhập'}
          </Link>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
            {error}
          </div>
          <Link
            to={user ? '/boards' : '/login'}
            className="rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-primary-hover)]"
          >
            {user ? 'Về trang chủ' : 'Về trang đăng nhập'}
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
