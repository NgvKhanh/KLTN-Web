import { useEffect, useState } from 'react';
import {
  fetchNotificationPreference,
  updateNotificationPreference,
  type NotificationPreference,
} from '../lib/api/notification';
import { getErrorMessage } from '../lib/errorMessage';
import { SkeletonRegion, SkeletonRows } from '../components/Skeleton';

type BoolKey = keyof NotificationPreference;

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** Ten doc duoc cho trinh doc man hinh (cong tac khong co chu hien thi). */
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${
        checked ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
          checked ? 'left-5' : 'left-0.5'
        }`}
      />
    </button>
  );
}

export default function NotificationSettingsPage() {
  const [pref, setPref] = useState<NotificationPreference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<BoolKey | null>(null);

  useEffect(() => {
    fetchNotificationPreference()
      .then(setPref)
      .catch((err) => setError(getErrorMessage(err, 'Không tải được cài đặt.')));
  }, []);

  async function toggle(key: BoolKey, value: boolean) {
    if (!pref) return;
    const prev = pref;
    setPref({ ...pref, [key]: value });
    setSavingKey(key);
    setError(null);
    try {
      const updated = await updateNotificationPreference({ [key]: value });
      setPref(updated);
    } catch (err) {
      setPref(prev);
      setError(getErrorMessage(err, 'Không lưu được thay đổi.'));
    } finally {
      setSavingKey(null);
    }
  }

  if (error && !pref) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!pref) {
    return (
      <SkeletonRegion label="Đang tải cài đặt thông báo…">
        <SkeletonRows rows={4} boxed />
      </SkeletonRegion>
    );
  }

  const row =
    'flex items-center gap-3 border-b border-slate-100 py-3 last:border-0 dark:border-slate-700';
  const rowText = 'flex-1';
  const rowTitle = 'text-sm font-medium text-slate-800 dark:text-slate-100';
  const rowDesc = 'text-xs text-slate-500 dark:text-slate-400';

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
        Cài đặt thông báo
      </h1>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Chọn loại thông báo bạn muốn nhận trong ứng dụng và qua email.
      </p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Trong ứng dụng
        </h2>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Hoạt động trên thẻ</p>
            <p className={rowDesc}>Bình luận, gán người, di chuyển, đổi hạn...</p>
          </div>
          <Toggle
            label="Hoạt động trên thẻ: thông báo trong ứng dụng"
            checked={pref.cardInApp}
            disabled={savingKey === 'cardInApp'}
            onChange={(v) => toggle('cardInApp', v)}
          />
        </div>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Bảng &amp; không gian làm việc</p>
            <p className={rowDesc}>Thêm thành viên, đổi vai trò, yêu cầu tham gia...</p>
          </div>
          <Toggle
            label="Bảng và không gian làm việc: thông báo trong ứng dụng"
            checked={pref.boardInApp}
            disabled={savingKey === 'boardInApp'}
            onChange={(v) => toggle('boardInApp', v)}
          />
        </div>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Nhắc hạn thẻ</p>
            <p className={rowDesc}>Theo lời nhắc bạn đặt trên từng thẻ.</p>
          </div>
          <Toggle
            label="Nhắc hạn thẻ: thông báo trong ứng dụng"
            checked={pref.dueReminderInApp}
            disabled={savingKey === 'dueReminderInApp'}
            onChange={(v) => toggle('dueReminderInApp', v)}
          />
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Email nhắc hạn
        </h2>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Gửi email khi sắp đến hạn</p>
            <p className={rowDesc}>Gửi ngay theo thời điểm bạn đã hẹn nhắc, không gộp lại.</p>
          </div>
          <Toggle
            label="Gửi email khi sắp đến hạn"
            checked={pref.dueReminderEmail}
            disabled={savingKey === 'dueReminderEmail'}
            onChange={(v) => toggle('dueReminderEmail', v)}
          />
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Nguy cơ trễ hạn
        </h2>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Thông báo trong ứng dụng</p>
            <p className={rowDesc}>Khi thẻ bạn được giao, quản lý hoặc theo dõi có nguy cơ trễ hạn hoặc đã trễ hạn.</p>
          </div>
          <Toggle
            label="Nguy cơ trễ hạn: thông báo trong ứng dụng"
            checked={pref.riskInApp}
            disabled={savingKey === 'riskInApp'}
            onChange={(v) => toggle('riskInApp', v)}
          />
        </div>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Gửi email</p>
            <p className={rowDesc}>Gửi ngay, tối đa 20 email mỗi ngày.</p>
          </div>
          <Toggle
            label="Nguy cơ trễ hạn: gửi email"
            checked={pref.riskEmail}
            disabled={savingKey === 'riskEmail'}
            onChange={(v) => toggle('riskEmail', v)}
          />
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Email tổng hợp hằng ngày
        </h2>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Bật email tổng hợp</p>
            <p className={rowDesc}>
              Mỗi 24 giờ, gửi 1 email tóm tắt số thông báo mới thay vì gửi rời rạc.
            </p>
          </div>
          <Toggle
            label="Email tóm tắt hằng ngày"
            checked={pref.dailyDigestEnabled}
            disabled={savingKey === 'dailyDigestEnabled'}
            onChange={(v) => toggle('dailyDigestEnabled', v)}
          />
        </div>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Gồm hoạt động trên thẻ</p>
          </div>
          <Toggle
            label="Email tóm tắt: gồm hoạt động trên thẻ"
            checked={pref.cardEmailDigest}
            disabled={!pref.dailyDigestEnabled || savingKey === 'cardEmailDigest'}
            onChange={(v) => toggle('cardEmailDigest', v)}
          />
        </div>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Gồm hoạt động bảng &amp; không gian</p>
          </div>
          <Toggle
            label="Email tóm tắt: gồm hoạt động bảng và không gian"
            checked={pref.boardEmailDigest}
            disabled={!pref.dailyDigestEnabled || savingKey === 'boardEmailDigest'}
            onChange={(v) => toggle('boardEmailDigest', v)}
          />
        </div>
      </section>
    </div>
  );
}
