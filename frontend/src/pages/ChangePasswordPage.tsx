import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { changePassword } from '../lib/api/auth';
import { getErrorMessage } from '../lib/errorMessage';

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 6) {
      setError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }
    if (next !== confirm) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }
    setBusy(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(getErrorMessage(err, 'Không đổi được mật khẩu.'));
    } finally {
      setBusy(false);
    }
  }

  const field =
    'mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
  const label =
    'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300';

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
        Đổi mật khẩu
      </h1>

      <form
        onSubmit={submit}
        className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800"
      >
        <label htmlFor="pw-current" className={label}>Mật khẩu hiện tại</label>
        <input
          id="pw-current"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          className={field}
        />

        <label htmlFor="pw-new" className={label}>Mật khẩu mới</label>
        <input
          id="pw-new"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          className={field}
        />

        <label htmlFor="pw-confirm" className={label}>Xác nhận mật khẩu mới</label>
        <input
          id="pw-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className={field}
        />

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {done && (
          <p className="mb-3 text-sm text-emerald-600">
            Đã đổi mật khẩu thành công.
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || !current || !next || !confirm}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {busy ? 'Đang đổi...' : 'Đổi mật khẩu'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Quay lại
          </button>
        </div>
      </form>
    </div>
  );
}
