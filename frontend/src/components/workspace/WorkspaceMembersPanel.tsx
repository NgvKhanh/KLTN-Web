import type { FormEvent } from 'react';
import { userCvUrl } from '../../lib/api/assign';
import type { Workspace, WorkspaceMember } from '../../types/workspace';
import Avatar from '../Avatar';
import { SkeletonRegion, SkeletonRows } from '../Skeleton';
import { FOCUS, INPUT, PANEL, PRIMARY_BUTTON, SECONDARY_BUTTON, roleLabel } from './workspaceUi';
import { WorkspaceIcon } from './WorkspaceIcon';

export type AssignableRole = 'ADMIN' | 'MEMBER';

interface Props {
  workspace: Workspace;
  members: WorkspaceMember[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  userId?: string;
  canManage: boolean;
  isOwner: boolean;
  cvIds: ReadonlySet<string>;
  busy: boolean;
  inviteEmail: string;
  onInviteEmail: (email: string) => void;
  inviteRole: AssignableRole;
  onInviteRole: (role: AssignableRole) => void;
  onInvite: (event: FormEvent) => void;
  onChangeRole: (userId: string, role: AssignableRole) => void;
  onRemove: (member: WorkspaceMember) => void;
  onTransfer: (member: WorkspaceMember) => void;
}

export default function WorkspaceMembersPanel(props: Props) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-indigo-100 bg-primary-soft p-4 text-sm leading-6 text-primary-ink dark:border-indigo-900">
        <p className="flex items-center gap-2 font-semibold"><WorkspaceIcon path="M12 16v-4M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" />Mời vào không gian sẽ cho phép truy cập những gì?</p>
        <p className="mt-1">Thành viên có thể xem và làm việc trên các bảng ở chế độ <strong>Không gian làm việc</strong>. Bảng <strong>Riêng tư</strong> cần được mời riêng trong từng bảng.</p>
        {props.workspace.isPersonal && <p className="mt-2 text-xs">Bạn đang dùng không gian cá nhân. Nếu chỉ cộng tác trên một bảng, hãy mời người đó ngay trong bảng.</p>}
      </div>

      <section aria-labelledby="workspace-members-heading" className={PANEL}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 id="workspace-members-heading" className="text-base font-semibold text-slate-800 dark:text-slate-100">Thành viên <span className="text-sm font-normal text-slate-400">({props.members.length})</span></h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Quản lý người tham gia và vai trò trong không gian này.</p></div>
          <button type="button" disabled={props.loading || props.busy} onClick={props.onReload} className={SECONDARY_BUTTON}>Làm mới thành viên</button>
        </div>

        {props.canManage && <form onSubmit={props.onInvite} className="mt-5 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
          <label htmlFor="workspace-invite-email" className="mb-2 block text-xs font-semibold text-slate-600 dark:text-slate-300">Mời thành viên bằng email</label>
          <div className="flex flex-wrap gap-2">
            <input id="workspace-invite-email" type="email" required value={props.inviteEmail} onChange={(event) => props.onInviteEmail(event.target.value)} placeholder="ten@example.com" disabled={props.busy} className={`w-full sm:w-auto sm:flex-1 ${INPUT}`} />
            <select aria-label="Vai trò người được mời" value={props.inviteRole} onChange={(event) => props.onInviteRole(event.target.value as AssignableRole)} disabled={props.busy} className={`flex-1 sm:flex-none ${INPUT}`}><option value="MEMBER">Thành viên</option><option value="ADMIN">Quản trị viên</option></select>
            <button type="submit" disabled={props.busy || !props.inviteEmail.trim()} className={PRIMARY_BUTTON}>Mời</button>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">Tài khoản đã xác minh được thêm ngay. Người chưa có tài khoản hoặc chưa xác minh email sẽ nhận email mời đăng ký.</p>
        </form>}

        {props.error ? <div role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"><p>{props.error}</p><button type="button" onClick={props.onReload} className={`mt-2 rounded font-semibold underline ${FOCUS}`}>Thử tải lại thành viên</button></div>
          : props.loading && props.members.length === 0 ? <SkeletonRegion label="Đang tải thành viên…" className="mt-4"><SkeletonRows rows={3} /></SkeletonRegion>
          : <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-700">
            {props.members.map((member) => {
              const isSelf = member.userId === props.userId;
              const editable = props.canManage && member.role !== 'OWNER';
              return <li key={member.id} className="flex flex-wrap items-center gap-3 py-4">
                <Avatar id={member.userId} name={member.user.name} avatarUrl={member.user.avatarUrl} className="h-10 w-10 text-xs" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{member.user.name}{isSelf && <span className="font-normal text-slate-400"> (bạn)</span>}</p><p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{member.user.email}</p></div>
                <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                  {props.cvIds.has(member.userId) && <a href={userCvUrl(member.userId)} download aria-label={`Xem CV của ${member.user.name}`} className={`rounded-lg px-2 py-1.5 text-xs font-medium text-primary-ink hover:bg-primary-soft ${FOCUS}`}>Xem CV</a>}
                  {editable ? <select aria-label={`Vai trò của ${member.user.name}`} value={member.role} disabled={props.busy} onChange={(event) => props.onChangeRole(member.userId, event.target.value as AssignableRole)} className={`${INPUT} text-xs`}><option value="MEMBER">Thành viên</option><option value="ADMIN">Quản trị viên</option></select>
                    : <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">{roleLabel(member.role)}</span>}
                  {props.isOwner && !props.workspace.isPersonal && !isSelf && member.role !== 'OWNER' && <button type="button" disabled={props.busy} onClick={() => props.onTransfer(member)} aria-label={`Chuyển quyền cho ${member.user.name}`} className={`rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700 ${FOCUS}`}>Chuyển quyền</button>}
                  {editable && !isSelf && <button type="button" disabled={props.busy} onClick={() => props.onRemove(member)} aria-label={`Xóa ${member.user.name} khỏi không gian`} className={`rounded-lg px-2 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-950/30 ${FOCUS}`}>Xóa</button>}
                </div>
              </li>;
            })}
          </ul>}
      </section>

      <section aria-label="Quyền theo vai trò" className="grid gap-3 sm:grid-cols-3">
        {[
          { title: 'Chủ không gian', description: 'Quản lý không gian, chuyển quyền sở hữu và xóa không gian nhóm khi không còn bảng.' },
          { title: 'Quản trị viên', description: 'Quản lý thành viên, đổi tên không gian và điều chỉnh cấu hình gợi ý phân công.' },
          { title: 'Thành viên', description: 'Tạo bảng và làm việc trên các bảng được chia sẻ với mình hoặc với không gian.' },
        ].map((role) => <div key={role.title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">{role.title}</h3><p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{role.description}</p></div>)}
      </section>
    </div>
  );
}
