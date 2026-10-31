import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteDeclaredCv,
  fetchDeclaredProfile,
  myCvUrl,
  saveDeclaredProfile,
  uploadDeclaredCv,
} from '../lib/api/assign';
import {
  SKILLS_MAX_CHARS,
  WORK_DESC_MAX,
  WORK_ITEMS_MAX,
  WORK_TITLE_MAX,
  draftIssues,
  draftOf,
  formatSize,
  inputOf,
  sameDraft,
  type ProfileDraft,
  type WorkItemDraft,
} from '../lib/declaredProfile';
import { formatViDate } from '../lib/assignDates';
import { getErrorMessage } from '../lib/errorMessage';
import type { DeclaredProfile } from '../types/assign';
import ConfirmDialog from './ConfirmDialog';
import {
  ProfileIcon,
  profileInput,
  profilePrimaryButton,
  profileSecondaryButton,
} from './profile/ProfileUi';

// Mục "Hồ sơ kỹ năng" của trang Hồ sơ cá nhân (ASSIGN_MODULE.md §17): kỹ năng, công việc đã làm và CV mà người dùng TỰ KHAI để
// gợi ý phân công dùng làm thành phần "Hồ sơ" ở MỌI không gian. Tải CV lên = máy chủ trích chữ (không dùng AI); tệp CV chỉ chính
// chủ và chủ / quản trị viên của một bảng có người đó (hoặc của không gian chứa bảng đó) tải được, VÀ chỉ khi chính chủ bật công tắc
// "chia sẻ CV" (mặc định tắt) - xem declaredProfile.service.ts (managedAmong, cvFileFor).

/** Một hàng công tắc (checkbox trình bày như công tắc): tiêu đề + giải thích. */
function SwitchRow({
  title,
  hint,
  checked,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
      <span className="min-w-0">
        <span className="font-medium">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{hint}</span>
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary dark:bg-slate-600"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-5 motion-reduce:transition-none"
        />
      </span>
    </label>
  );
}

const inputCls = profileInput + ' resize-y';
const labelCls = 'mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200';
const hintCls = 'mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400';
const secondaryBtn = profileSecondaryButton;

type Busy = 'save' | 'upload' | 'delete' | null;

export default function DeclaredProfileSection() {
  const [saved, setSaved] = useState<DeclaredProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const newKey = useRef(0);

  const load = useCallback(() => {
    fetchDeclaredProfile()
      .then((p) => {
        setLoadError(null);
        setSaved(p);
        setDraft(draftOf(p));
      })
      .catch((err) => setLoadError(getErrorMessage(err, 'Không tải được hồ sơ kỹ năng.')));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
        {loadError}{' '}
        <button
          type="button"
          onClick={() => {
            setLoadError(null);
            load();
          }}
          className="font-medium underline"
        >
          Thử lại
        </button>
      </p>
    );
  }
  if (!saved || !draft) {
    return (
      <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
        Đang tải…
      </p>
    );
  }

  const issues = draftIssues(draft);
  const dirty = !sameDraft(draft, draftOf(saved));
  const patch = (p: Partial<ProfileDraft>) => setDraft({ ...draft, ...p });
  const patchWork = (key: string, p: Partial<WorkItemDraft>) =>
    patch({ workItems: draft.workItems.map((w) => (w.key === key ? { ...w, ...p } : w)) });

  function startAction() {
    setError(null);
    setNotice(null);
  }

  async function save() {
    if (!draft || !dirty || issues.length > 0 || busy) return;
    setBusy('save');
    startAction();
    try {
      const p = await saveDeclaredProfile(inputOf(draft));
      setSaved(p);
      setDraft(draftOf(p));
      setNotice('Đã lưu hồ sơ kỹ năng.');
    } catch (err) {
      setError(getErrorMessage(err, 'Không lưu được hồ sơ kỹ năng.'));
    } finally {
      setBusy(null);
    }
  }

  async function onPickCv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy || !draft) return;
    setBusy('upload');
    startAction();
    try {
      const r = await uploadDeclaredCv(file);
      // Máy chủ đã lưu tệp + chữ đọc từ tệp (gợi ý dùng thẳng nội dung tệp, không có ô sửa chữ);
      // phần kỹ năng / công việc đang sửa dở vẫn giữ nguyên
      setSaved(r.profile);
      setDraft({ ...draft, cvText: r.text });
      setNotice(
        `Đã lưu CV, gợi ý phân công sẽ dùng nội dung trong tệp (đọc được ${r.text.length.toLocaleString('vi-VN')} ký tự${r.truncated ? '; tệp dài nên chỉ dùng phần đầu' : ''}).`
      );
    } catch (err) {
      setError(getErrorMessage(err, 'Không đọc được tệp CV.'));
    } finally {
      setBusy(null);
    }
  }

  async function doDeleteCv() {
    if (!draft) return;
    setBusy('delete');
    startAction();
    try {
      const p = await deleteDeclaredCv();
      setSaved(p);
      setDraft({ ...draft, cvText: '' });
      setNotice('Đã xoá CV (cả tệp và phần chữ).');
    } catch (err) {
      setError(getErrorMessage(err, 'Không xoá được CV.'));
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  const cv = saved.cv;

  return (
    <div className="flex flex-col gap-6">
      <SwitchRow
        title="Dùng hồ sơ này cho gợi ý phân công"
        hint="Tắt thì gợi ý coi như bạn chưa khai, và người khác không tải được CV của bạn."
        checked={draft.useForAssign}
        onChange={(checked) => patch({ useForAssign: checked })}
      />

      <div>
        <label htmlFor="declared-skills" className={labelCls}>
          Kỹ năng
        </label>
        <textarea
          id="declared-skills"
          rows={3}
          value={draft.skillsText}
          onChange={(e) => patch({ skillsText: e.target.value })}
          placeholder="vd: React, thiết kế giao diện, SQL, kiểm thử API"
          className={inputCls}
          aria-describedby="declared-skills-hint"
        />
        <p
          id="declared-skills-hint"
          className={hintCls + ' flex flex-wrap justify-between gap-x-3'}
        >
          <span>Phân cách các kỹ năng bằng dấu phẩy hoặc xuống dòng.</span>
          <span className="tabular-nums">
            {draft.skillsText.length}/{SKILLS_MAX_CHARS}
          </span>
        </p>
      </div>

      <div className="border-t border-slate-100 pt-6 dark:border-slate-700">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Công việc đã làm
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Dự án và kinh nghiệm nổi bật của bạn.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              newKey.current += 1;
              patch({
                workItems: [
                  ...draft.workItems,
                  { key: `moi-${newKey.current}`, title: '', description: '' },
                ],
              });
            }}
            disabled={draft.workItems.length >= WORK_ITEMS_MAX}
            className={secondaryBtn}
          >
            <ProfileIcon name="plus" />
            Thêm công việc
          </button>
        </div>
        {draft.workItems.length === 0 && (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-7 text-center dark:border-slate-600 dark:bg-slate-900/20">
            <span className="mb-3 rounded-lg border border-slate-200 bg-white p-2.5 text-slate-400 dark:border-slate-600 dark:bg-slate-800">
              <ProfileIcon name="briefcase" className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Chưa có công việc nào.
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              Thêm một công việc để giới thiệu kinh nghiệm của bạn.
            </p>
          </div>
        )}
        <ul className="flex flex-col gap-3">
          {draft.workItems.map((w, i) => (
            <li
              key={w.key}
              data-testid={`work-${i}`}
              className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-900/20"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Công việc {String(i + 1).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    patch({ workItems: draft.workItems.filter((x) => x.key !== w.key) })
                  }
                  aria-label={`Xoá công việc ${i + 1}`}
                  className="shrink-0 rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-500 dark:text-red-400 dark:hover:bg-red-900/30"
                >
                  Xoá
                </button>
              </div>
              <div>
                <input
                  value={w.title}
                  onChange={(e) => patchWork(w.key, { title: e.target.value })}
                  maxLength={WORK_TITLE_MAX}
                  placeholder="Tên công việc, vd: Trang quản trị bán hàng"
                  aria-label={`Tên công việc ${i + 1}`}
                  className={inputCls}
                />
              </div>
              <textarea
                value={w.description}
                onChange={(e) => patchWork(w.key, { description: e.target.value })}
                rows={2}
                placeholder="Mô tả ngắn (tuỳ chọn): bạn đã làm gì, dùng công nghệ gì"
                aria-label={`Mô tả công việc ${i + 1}`}
                className={inputCls + ' mt-3'}
              />
            </li>
          ))}
        </ul>
        <p className={hintCls}>
          Tối đa {WORK_ITEMS_MAX} công việc; tên tối đa {WORK_TITLE_MAX} ký tự, mô tả tối đa{' '}
          {WORK_DESC_MAX} ký tự.
        </p>
      </div>

      <div className="border-t border-slate-100 pt-6 dark:border-slate-700">
        <p className={labelCls}>CV của bạn</p>
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-5 dark:border-slate-600 dark:bg-slate-900/20">
          <div className="flex items-start gap-3">
            <span className="rounded-lg border border-slate-200 bg-white p-2.5 text-primary-ink dark:border-slate-600 dark:bg-slate-800">
              <ProfileIcon name="file" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              {cv ? (
                <div className="flex flex-col items-start gap-1 text-sm">
                  <span className="max-w-full break-words font-medium text-slate-800 dark:text-slate-100">
                    {cv.fileName}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {formatSize(cv.size)} · tải lên {formatViDate(cv.uploadedAt)}
                  </span>
                  <a
                    href={myCvUrl()}
                    download
                    className="text-sm font-medium text-primary-ink hover:underline"
                  >
                    Tải về
                  </a>
                </div>
              ) : (
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  Chưa tải CV lên.
                </p>
              )}
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                PDF hoặc DOCX · Tối đa 5MB
              </p>
              {/* Du lieu tu ban cu (con o sua chu CV): khong con o de nhin thay nen noi ro tinh trang */}
              {cv && saved.cvText === null && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Chưa có nội dung đọc từ tệp này. Tải lại CV để dùng cho gợi ý phân công.
                </p>
              )}
              {!cv && saved.cvText !== null && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Gợi ý đang dùng phần chữ CV bạn nhập tay trước đây. Tải CV lên để thay, hoặc Xoá CV để bỏ.
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className={secondaryBtn}
            >
              <ProfileIcon name="upload" />
              {busy === 'upload' ? 'Đang đọc CV…' : cv ? 'Thay CV' : 'Tải CV lên'}
            </button>
            {(cv || saved.cvText !== null) && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy !== null}
                className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-500 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                Xoá CV
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              hidden
              data-testid="cv-file"
              onChange={(e) => void onPickCv(e)}
            />
          </div>
        </div>
      </div>

      <SwitchRow
        title="Cho phép quản trị bảng / không gian chung tải tệp CV của tôi"
        hint={
          draft.useForAssign
            ? 'Mặc định TẮT: khi tắt, chỉ mình bạn tải được tệp CV. Khi bật, chủ hoặc quản trị viên của bảng (hoặc không gian) mà bạn tham gia tải được. Gợi ý phân công vẫn dùng chữ trích từ CV dù công tắc này tắt.'
            : 'Hiện chưa có tác dụng vì bạn đã tắt "Dùng hồ sơ này cho gợi ý phân công" (khi đó người khác không tải được CV của bạn).'
        }
        checked={draft.cvShared}
        onChange={(checked) => patch({ cvShared: checked })}
      />

      {issues.length > 0 && (
        <ul
          role="alert"
          className="list-disc rounded-lg bg-red-50 py-2 pl-7 pr-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
        >
          {issues.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
        >
          {notice}
        </p>
      )}

      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
        Thông tin tự khai chưa được xác minh, được kết hợp với lịch sử làm việc để gợi ý phân công ở
        mọi không gian bạn tham gia.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5 dark:border-slate-700">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {dirty ? 'Bạn có thay đổi chưa lưu.' : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <button
              type="button"
              onClick={() => setDraft(draftOf(saved))}
              disabled={busy !== null}
              className={secondaryBtn}
            >
              Hoàn tác
            </button>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || issues.length > 0 || busy !== null}
            className={profilePrimaryButton}
          >
            {busy === 'save' ? 'Đang lưu…' : 'Lưu hồ sơ'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Xoá CV?"
        message="Tệp CV và phần chữ trích từ CV sẽ bị xoá hẳn; kỹ năng và công việc đã khai vẫn giữ nguyên."
        confirmLabel="Xoá CV"
        danger
        busy={busy === 'delete'}
        onConfirm={() => void doDeleteCv()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
