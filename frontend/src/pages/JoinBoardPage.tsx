import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { previewInvite, requestToJoin } from '../lib/api/board';
import { assetUrl } from '../lib/assets';
import { getErrorMessage } from '../lib/errorMessage';
import type { InvitePreview } from '../types/board';
import { Skeleton, SkeletonRegion } from '../components/Skeleton';

export default function JoinBoardPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<InvitePreview['status']>('none');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!token) return;
    previewInvite(token)
      .then((p) => {
        setPreview(p);
        setStatus(p.status);
      })
      .catch((err) =>
        setError(getErrorMessage(err, 'Link mời không hợp lệ hoặc đã bị thu hồi.'))
      )
      .finally(() => setLoading(false));
  }, [token]);

  async function handleJoin() {
    if (!token) return;
    setSending(true);
    setError(null);
    try {
      await requestToJoin(token);
      setStatus('pending');
    } catch (err) {
      setError(getErrorMessage(err, 'Không gửi được yêu cầu.'));
    } finally {
      setSending(false);
    }
  }

  const bgStyle = preview?.board.backgroundImage
    ? {
        backgroundImage: `url(${assetUrl(preview.board.backgroundImage)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { backgroundColor: preview?.board.color ?? '#0079BF' };

  return (
    <div className="grid min-h-screen place-items-center bg-[var(--app-bg)] p-4">
      <div className="w-[420px] max-w-full rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        {loading ? (
          <SkeletonRegion label="Đang tải lời mời…" className="flex flex-col items-center gap-3">
            <Skeleton className="h-14 w-14 rounded-xl" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </SkeletonRegion>
        ) : error && !preview ? (
          <>
            <p className="text-sm text-red-600">{error}</p>
            <Link
              to="/boards"
              className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
            >
              Về trang chủ
            </Link>
          </>
        ) : preview ? (
          <>
            <div
              className="mx-auto mb-4 h-24 w-full rounded-lg shadow-inner"
              style={bgStyle}
            />
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Lời mời tham gia bảng
            </p>
            <h1 className="mt-1 text-lg font-semibold text-slate-800">
              {preview.board.name}
            </h1>

            {status === 'member' ? (
              <>
                <p className="mt-3 text-sm text-slate-500">
                  Bạn đã là thành viên của bảng này.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(`/boards/${preview.board.id}`)}
                  className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
                >
                  Mở bảng
                </button>
              </>
            ) : status === 'pending' ? (
              <>
                <p className="mt-3 text-sm text-slate-500">
                  Đã gửi yêu cầu tham gia. Vui lòng chờ quản trị viên duyệt.
                </p>
                <Link
                  to="/boards"
                  className="mt-4 inline-block text-sm font-medium text-primary-ink hover:underline"
                >
                  Về trang chủ
                </Link>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-slate-500">
                  Gửi yêu cầu để quản trị viên thêm bạn vào bảng.
                </p>
                {error && (
                  <p className="mt-2 text-xs text-red-600">{error}</p>
                )}
                <button
                  type="button"
                  disabled={sending}
                  onClick={handleJoin}
                  className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                >
                  {sending ? 'Đang gửi...' : 'Xin tham gia'}
                </button>
              </>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
