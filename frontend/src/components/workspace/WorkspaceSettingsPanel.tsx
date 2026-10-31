import { useState, type FormEvent } from 'react';
import type { Workspace } from '../../types/workspace';
import AssignWeightsPanel from '../AssignWeightsPanel';
import { FOCUS, INPUT, PANEL, PRIMARY_BUTTON } from './workspaceUi';
import { WorkspaceIcon } from './WorkspaceIcon';

interface Props {
  workspace: Workspace;
  canManage: boolean;
  isOwner: boolean;
  busy: boolean;
  nameDraft: string;
  onNameDraft: (name: string) => void;
  onSaveName: (event: FormEvent) => void;
  onLeave: () => void;
  onDelete: () => void;
}

export default function WorkspaceSettingsPanel(props: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <div className="space-y-5">
      <section className={PANEL}>
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Thông tin không gian</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{props.workspace.isPersonal ? 'Không gian mặc định để tập hợp các bảng và công việc của bạn.' : 'Tên giúp các thành viên nhận biết nhóm và tìm đúng các bảng của nhóm.'}</p>
        <form onSubmit={props.onSaveName} className="mt-5">
          <label htmlFor="workspace-name" className="mb-2 block text-xs font-semibold text-slate-600 dark:text-slate-300">Tên không gian</label>
          <div className="flex flex-wrap gap-2">
            <input id="workspace-name" value={props.nameDraft} onChange={(event) => props.onNameDraft(event.target.value)} disabled={!props.canManage || props.workspace.isPersonal || props.busy} maxLength={100} required className={`w-full disabled:text-slate-400 sm:w-auto sm:flex-1 ${INPUT}`} />
            {props.canManage && !props.workspace.isPersonal && <button type="submit" disabled={props.busy || !props.nameDraft.trim() || props.nameDraft.trim() === props.workspace.name} className={PRIMARY_BUTTON}>Lưu tên</button>}
          </div>
          {props.workspace.isPersonal && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Không gian cá nhân giữ tên mặc định; không thể xóa hoặc chuyển quyền sở hữu.</p>}
          {!props.canManage && !props.workspace.isPersonal && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Chủ không gian và quản trị viên có thể đổi tên.</p>}
        </form>
      </section>

      <section className={PANEL}>
        <button type="button" aria-expanded={advancedOpen} aria-controls="workspace-assignment-settings" onClick={() => setAdvancedOpen((value) => !value)} className={`flex w-full items-start gap-3 rounded-lg text-left ${FOCUS}`}>
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-ink"><WorkspaceIcon path="M4 7h16M4 17h16M8 4v6M16 14v6" className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">Nâng cao · Gợi ý phân công</span><span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">Điều chỉnh cách xếp hạng người phù hợp và cấu hình làm việc của bạn. Có tác dụng khi dùng gợi ý phân công trong thẻ.</span></span>
          <WorkspaceIcon path="m9 5 7 7-7 7" className={`mt-2 h-4 w-4 text-slate-400 transition-transform ${advancedOpen ? 'rotate-90' : ''}`} />
        </button>
        <div id="workspace-assignment-settings" hidden={!advancedOpen}>
          {advancedOpen && <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-700"><AssignWeightsPanel workspaceId={props.workspace.id} canManage={props.canManage} /></div>}
        </div>
      </section>

      {(!props.isOwner || !props.workspace.isPersonal) && <section className="rounded-2xl border border-rose-200 bg-white p-5 dark:border-rose-900/60 dark:bg-slate-800">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{props.isOwner ? 'Xóa không gian' : 'Rời khỏi không gian'}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{props.isOwner ? 'Chỉ có thể xóa khi không còn bảng bên trong. Chuyển quyền sở hữu cho thành viên khác trong mục Thành viên & quyền nếu bạn muốn bàn giao nhóm.' : 'Bạn sẽ mất quyền truy cập qua không gian. Những quyền được cấp trực tiếp trong từng bảng được giữ lại.'}</p>
        <button type="button" disabled={props.busy} onClick={props.isOwner ? props.onDelete : props.onLeave} className={`mt-4 rounded-xl border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/30 ${FOCUS}`}>{props.isOwner ? 'Xóa không gian' : 'Rời khỏi không gian'}</button>
      </section>}
    </div>
  );
}
