import { GoogleLogin } from '@react-oauth/google';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getErrorMessage } from '../../lib/errorMessage';

// Chi hien khi da cau hinh VITE_GOOGLE_CLIENT_ID
const CONFIGURED = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

export default function GoogleAuthButton() {
  const { loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);

  if (!CONFIGURED) return null;

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-medium text-slate-400">hoặc</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <div className="flex justify-center">
        <GoogleLogin
          onSuccess={async (res) => {
            setError(null);
            if (!res.credential) {
              setError('Không nhận được thông tin từ Google.');
              return;
            }
            try {
              await loginWithGoogle(res.credential);
              const redirectTo =
                (location.state as { from?: string } | null)?.from ?? '/boards';
              navigate(redirectTo, { replace: true });
            } catch (err) {
              setError(getErrorMessage(err, 'Đăng nhập Google thất bại.'));
            }
          }}
          onError={() => setError('Đăng nhập Google bị hủy hoặc thất bại.')}
          text="continue_with"
          shape="rectangular"
          width="320"
        />
      </div>
    </div>
  );
}
