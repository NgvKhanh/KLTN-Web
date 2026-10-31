import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Avatar from '../components/Avatar';
import DeclaredProfileSection from '../components/DeclaredProfileSection';
import {
  ProfileIcon,
  profileInput,
  profilePrimaryButton,
  profileSecondaryButton,
} from '../components/profile/ProfileUi';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { updateProfile, uploadAvatar } from '../lib/api/auth';
import { getErrorMessage } from '../lib/errorMessage';

const TABS = [
  { id: 'personal', label: 'Thông tin' },
  { id: 'skills', label: 'Kỹ năng & CV' },
  { id: 'preferences', label: 'Tùy chọn' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const THEMES = [
  { id: 'light', label: 'Sáng', icon: 'sun' },
  { id: 'dark', label: 'Tối', icon: 'moon' },
  { id: 'system', label: 'Hệ thống', icon: 'monitor' },
] as const;

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

type Feedback = { kind: 'error' | 'ok'; text: string } | null;

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

const CARD = 'rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800';
const ROW_LABEL = 'text-sm font-medium text-slate-700 sm:pt-2 dark:text-slate-200';

// 1 dong cai dat: nhan ben trai, noi dung ben phai (man hinh hep thi xep chong)
function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 px-5 py-5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-6 sm:px-6">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={ROW_LABEL}>
          {label}
        </label>
      ) : (
        <p className={ROW_LABEL}>{label}</p>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Message({ fb }: { fb: Feedback }) {
  if (!fb) return null;
  return fb.kind === 'error' ? (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {fb.text}
    </p>
  ) : (
    <p role="status" className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
      <ProfileIcon name="check" />
      {fb.text}
    </p>
  );
}

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<TabId>('personal');
  const [name, setName] = useState(user?.name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [showUrl, setShowUrl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarFb, setAvatarFb] = useState<Feedback>(null);
  const [formFb, setFormFb] = useState<Feedback>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = avatarUrl.trim();
  const dirty = name.trim() !== (user?.name ?? '') || preview !== (user?.avatarUrl ?? '');
  const pending = busy || uploading;

  function clearFeedback() {
    setAvatarFb(null);
    setFormFb(null);
  }

  // Tab theo chuan ARIA: mui ten trai/phai, Home/End chuyen tab va dua focus theo
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next]!.id);
    document.getElementById(`tab-${TABS[next]!.id}`)?.focus();
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || pending) return;
    clearFeedback();
    if (!AVATAR_TYPES.includes(file.type) || file.size > AVATAR_MAX_BYTES) {
      setAvatarFb({ kind: 'error', text: 'Chọn ảnh PNG, JPG, WEBP hoặc GIF, tối đa 2MB.' });
      return;
    }
    setUploading(true);
    try {
      const updated = await uploadAvatar(file);
      updateUser(updated);
      setAvatarUrl(updated.avatarUrl ?? '');
      setAvatarFb({ kind: 'ok', text: 'Đã đổi ảnh đại diện.' });
    } catch (err) {
      setAvatarFb({ kind: 'error', text: getErrorMessage(err, 'Không tải được ảnh đại diện.') });
    } finally {
      setUploading(false);
    }
  }

  async function removeAvatar() {
    if (pending) return;
    setUploading(true);
    clearFeedback();
    try {
      const updated = await updateProfile({ avatarUrl: null });
      updateUser(updated);
      setAvatarUrl('');
      setAvatarFb({ kind: 'ok', text: 'Đã xoá ảnh đại diện.' });
    } catch (err) {
      setAvatarFb({ kind: 'error', text: getErrorMessage(err, 'Không xoá được ảnh đại diện.') });
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !dirty || pending) return;
    setBusy(true);
    clearFeedback();
    try {
      const updated = await updateProfile({ name: name.trim(), avatarUrl: preview || null });
      updateUser(updated);
      setName(updated.name);
      setAvatarUrl(updated.avatarUrl ?? '');
      setFormFb({ kind: 'ok', text: 'Đã lưu.' });
    } catch (err) {
      setFormFb({ kind: 'error', text: getErrorMessage(err, 'Không lưu được hồ sơ.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl pb-6">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Hồ sơ</h1>

      <div
        role="tablist"
        aria-label="Hồ sơ"
        className="mt-4 flex gap-6 border-b border-slate-200 dark:border-slate-700"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={onTabKey}
              className={`-mb-px shrink-0 border-b-2 px-0.5 pb-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                active
                  ? 'border-primary text-primary-ink'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={AVATAR_TYPES.join(',')}
        aria-label="Chọn ảnh đại diện"
        hidden
        onChange={onPickAvatar}
      />

      {/* Giu ca 3 tab trong DOM: chuyen tab khong mat phan dang go do */}
      <div id="panel-personal" role="tabpanel" aria-labelledby="tab-personal" hidden={tab !== 'personal'} className="mt-6">
        <form onSubmit={submit} className={CARD}>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            <Row label="Ảnh đại diện">
              <div className="flex items-center gap-4">
                <Avatar
                  id={user?.id ?? 'me'}
                  name={user?.name ?? '?'}
                  avatarUrl={preview || null}
                  className="h-16 w-16 shrink-0 text-xl"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={pending}
                      className={profileSecondaryButton}
                    >
                      {uploading ? 'Đang cập nhật…' : preview ? 'Đổi ảnh' : 'Tải ảnh lên'}
                    </button>
                    {preview && (
                      <button
                        type="button"
                        onClick={removeAvatar}
                        disabled={pending}
                        className="min-h-10 rounded-lg px-2 text-sm text-slate-500 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 dark:text-slate-400 dark:hover:text-red-400"
                      >
                        Xoá ảnh
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    PNG, JPG, WEBP hoặc GIF, tối đa 2MB ·{' '}
                    <button
                      type="button"
                      aria-expanded={showUrl}
                      aria-controls="profile-avatar-url"
                      onClick={() => setShowUrl((v) => !v)}
                      className="font-medium text-primary-ink hover:underline"
                    >
                      {showUrl ? 'Ẩn ô liên kết' : 'Dùng liên kết ảnh'}
                    </button>
                  </p>
                </div>
              </div>
              <input
                id="profile-avatar-url"
                aria-label="Liên kết ảnh đại diện"
                hidden={!showUrl}
                value={avatarUrl}
                disabled={pending}
                onChange={(e) => {
                  setAvatarUrl(e.target.value);
                  clearFeedback();
                }}
                placeholder="https://example.com/avatar.jpg"
                className={`${profileInput} mt-3`}
              />
              {avatarFb && (
                <div className="mt-2">
                  <Message fb={avatarFb} />
                </div>
              )}
            </Row>

            <Row label="Tên hiển thị" htmlFor="profile-name">
              <input
                id="profile-name"
                autoComplete="name"
                required
                minLength={2}
                maxLength={100}
                value={name}
                disabled={pending}
                onChange={(e) => {
                  setName(e.target.value);
                  clearFeedback();
                }}
                className={`${profileInput} sm:max-w-sm`}
              />
            </Row>

            <Row label="Email">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-800 sm:pt-2 dark:text-slate-100">
                <span className="min-w-0 break-all">{user?.email}</span>
                {user?.emailVerifiedAt ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <ProfileIcon name="check" className="h-3.5 w-3.5" />
                    Đã xác minh
                  </span>
                ) : (
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    Chưa xác minh
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Dùng để đăng nhập, không đổi được.
              </p>
            </Row>

            <Row label="Mật khẩu">
              <Link to="/settings/password" className={profileSecondaryButton}>
                Đổi mật khẩu
              </Link>
            </Row>

            <Row label="Tham gia">
              <p className="text-sm text-slate-800 sm:pt-2 dark:text-slate-100">{fmtDate(user?.createdAt)}</p>
            </Row>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-5 py-4 sm:px-6 dark:border-slate-700">
            <div className="mr-auto">
              <Message fb={formFb} />
            </div>
            {dirty && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setName(user?.name ?? '');
                  setAvatarUrl(user?.avatarUrl ?? '');
                  clearFeedback();
                }}
                className={profileSecondaryButton}
              >
                Hoàn tác
              </button>
            )}
            <button
              type="submit"
              disabled={pending || !name.trim() || !dirty}
              className={profilePrimaryButton}
            >
              {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      </div>

      <div id="panel-skills" role="tabpanel" aria-labelledby="tab-skills" hidden={tab !== 'skills'} className="mt-6">
        <section className={`${CARD} p-5 sm:p-6`}>
          <DeclaredProfileSection />
        </section>
      </div>

      <div id="panel-preferences" role="tabpanel" aria-labelledby="tab-preferences" hidden={tab !== 'preferences'} className="mt-6">
        <section className={`${CARD} divide-y divide-slate-100 dark:divide-slate-700`}>
          <Row label="Giao diện">
            <div
              role="radiogroup"
              aria-label="Giao diện"
              className="inline-grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900/60"
            >
              {THEMES.map((t) => {
                const checked = theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => setTheme(t.id)}
                    className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-primary ${
                      checked
                        ? 'bg-white text-primary-ink shadow-sm dark:bg-slate-700'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    <ProfileIcon name={t.icon} />
                    {t.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Lưu trên trình duyệt này. “Hệ thống” đi theo cài đặt sáng/tối của máy.
            </p>
          </Row>
          <Row label="Thông báo">
            <Link to="/settings/notifications" className={profileSecondaryButton}>
              Cài đặt thông báo
            </Link>
          </Row>
        </section>
      </div>
    </div>
  );
}
