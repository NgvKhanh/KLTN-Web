import { Suspense, useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import { CreateBoardDialog } from '../components/board/lazy';
import { ModalLoading } from '../components/PageLoading';
import WorkspaceBoardsPanel from '../components/workspace/WorkspaceBoardsPanel';
import WorkspaceMembersPanel, { type AssignableRole } from '../components/workspace/WorkspaceMembersPanel';
import WorkspaceSettingsPanel from '../components/workspace/WorkspaceSettingsPanel';
import { FOCUS, PANEL, PRIMARY_BUTTON, SECONDARY_BUTTON, roleLabel } from '../components/workspace/workspaceUi';
import { WorkspaceIcon } from '../components/workspace/WorkspaceIcon';
import { Skeleton, SkeletonRegion, SkeletonRows } from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';
import { useBoards } from '../context/BoardsContext';
import { useWorkspaces } from '../context/WorkspacesContext';
import {
  addWorkspaceMember, changeWorkspaceMemberRole, deleteWorkspace, fetchWorkspace,
  fetchWorkspaceMembers, fetchWorkspaceOverview, removeWorkspaceMember,
  transferWorkspaceOwnership, updateWorkspace,
  type OverviewStatusFilter, type WorkspaceOverview,
} from '../lib/api/workspace';
import { getErrorMessage } from '../lib/errorMessage';
import { socket } from '../lib/socket';
import { useCvAccess } from '../lib/useCvAccess';
import type { Board } from '../types/board';
import type { Workspace, WorkspaceMember } from '../types/workspace';

const TABS = [
  { id: 'boards', label: 'Bảng & tiến độ', icon: 'M4 4h6v16H4zM14 4h6v10h-6z' },
  { id: 'members', label: 'Thành viên & quyền', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { id: 'settings', label: 'Cài đặt', icon: 'M4 7h16M4 17h16M8 4v6M16 14v6' },
] as const;
type Tab = typeof TABS[number]['id'];

// Remount on workspace changes so drafts, filters and pending requests stay with their workspace.
export default function WorkspaceSettingsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return workspaceId ? <WorkspaceSettingsContent key={workspaceId} workspaceId={workspaceId} /> : null;
}

function WorkspaceSettingsContent({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: Tab = TABS.find((item) => item.id === tabParam)?.id ?? 'boards';
  const tabId = useId();
  const { user } = useAuth();
  const { boards, isLoading: boardsLoading, error: boardsError, reload: reloadBoards, upsertBoard } = useBoards();
  const { reload: reloadWorkspaces, removeWorkspace, setCurrentWorkspaceId } = useWorkspaces();

  const [ws, setWs] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const cvIds = useCvAccess(members.map((member) => member.userId), tab === 'members' && !membersError);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<OverviewStatusFilter>('all');
  const [nameDraft, setNameDraft] = useState('');
  const savedName = useRef('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AssignableRole>('MEMBER');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<WorkspaceMember | null>(null);
  const [transferTarget, setTransferTarget] = useState<WorkspaceMember | null>(null);
  const requestSequences = useRef({ workspace: 0, members: 0, overview: 0 });

  const loadWorkspace = useCallback(() => {
    const seq = ++requestSequences.current.workspace;
    fetchWorkspace(workspaceId).then((data) => {
      if (seq !== requestSequences.current.workspace) return;
      const previousName = savedName.current;
      setNameDraft((draft) => draft === previousName ? data.name : draft);
      savedName.current = data.name;
      setWs(data);
      setLoadError(null);
    }).catch((error) => {
      if (seq === requestSequences.current.workspace) setLoadError(getErrorMessage(error, 'Không tải được không gian này.'));
    });
  }, [workspaceId]);

  const loadMembers = useCallback(() => {
    const seq = ++requestSequences.current.members;
    fetchWorkspaceMembers(workspaceId).then((data) => {
      if (seq === requestSequences.current.members) setMembers(data);
    }).catch((error) => {
      if (seq === requestSequences.current.members) setMembersError(getErrorMessage(error, 'Không tải được thành viên.'));
    }).finally(() => {
      if (seq === requestSequences.current.members) setMembersLoading(false);
    });
  }, [workspaceId]);

  const loadOverview = useCallback(() => {
    const seq = ++requestSequences.current.overview;
    fetchWorkspaceOverview(workspaceId, { assigneeId: assigneeFilter || undefined, status: statusFilter })
      .then((data) => {
        if (seq === requestSequences.current.overview) setOverview(data);
      }).catch((error) => {
        if (seq === requestSequences.current.overview) setOverviewError(getErrorMessage(error, 'Không tải được tổng quan.'));
      }).finally(() => {
        if (seq === requestSequences.current.overview) setOverviewLoading(false);
      });
  }, [workspaceId, assigneeFilter, statusFilter]);

  useEffect(() => {
    loadWorkspace();
    loadMembers();
    const sequences = requestSequences.current;
    return () => { sequences.workspace++; sequences.members++; };
  }, [loadWorkspace, loadMembers]);

  useEffect(() => {
    loadOverview();
    const sequences = requestSequences.current;
    return () => { sequences.overview++; };
  }, [loadOverview]);

  useEffect(() => {
    if (ws?.id) setCurrentWorkspaceId(ws.id);
  }, [ws?.id, setCurrentWorkspaceId]);

  useEffect(() => {
    function onChanged(event?: { workspaceId?: string }) {
      if (event?.workspaceId && event.workspaceId !== workspaceId) return;
      loadWorkspace();
      setMembersLoading(true);
      setMembersError(null);
      loadMembers();
      setOverviewLoading(true);
      setOverviewError(null);
      loadOverview();
    }
    socket.on('workspace:changed', onChanged);
    return () => { socket.off('workspace:changed', onChanged); };
  }, [workspaceId, loadWorkspace, loadMembers, loadOverview]);

  useEffect(() => {
    if (!createOpen) return;
    function onDown(event: MouseEvent) {
      if (!createRef.current?.contains(event.target as Node)) setCreateOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setCreateOpen(false);
        createButtonRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [createOpen]);

  const myRole = ws?.myRole ?? 'MEMBER';
  const isOwner = myRole === 'OWNER';
  const canManage = isOwner || myRole === 'ADMIN';
  const wsBoards = boards.filter((board) => board.workspaceId === workspaceId);

  function refreshMembers() {
    setMembersLoading(true);
    setMembersError(null);
    loadMembers();
  }

  function refreshOverview() {
    setOverviewLoading(true);
    setOverviewError(null);
    loadOverview();
  }

  function filterAssignee(id: string) {
    if (id === assigneeFilter) return;
    setAssigneeFilter(id);
    setOverviewLoading(true);
    setOverviewError(null);
  }

  function filterStatus(status: OverviewStatusFilter) {
    if (status === statusFilter) return;
    setStatusFilter(status);
    setOverviewLoading(true);
    setOverviewError(null);
  }

  function selectTab(next: Tab) {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      if (next === 'boards') params.delete('tab');
      else params.set('tab', next);
      return params;
    }, { replace: true });
    setCreateOpen(false);
    setActionError(null);
    setNotice(null);
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    selectTab(TABS[next].id);
    document.getElementById(`${tabId}-${TABS[next].id}`)?.focus();
  }

  async function runAction(action: () => Promise<void>, fallback: string) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try { await action(); }
    catch (error) { setActionError(getErrorMessage(error, fallback)); }
    finally { setBusy(false); }
  }

  function saveName(event: FormEvent) {
    event.preventDefault();
    if (!canManage || ws?.isPersonal || !nameDraft.trim()) return;
    void runAction(async () => {
      const updated = await updateWorkspace(workspaceId, nameDraft.trim());
      requestSequences.current.workspace++;
      savedName.current = updated.name;
      setNameDraft(updated.name);
      setWs((current) => current ? { ...current, name: updated.name } : current);
      setNotice('Đã cập nhật tên không gian.');
      void reloadWorkspaces();
      void reloadBoards();
    }, 'Không đổi được tên.');
  }

  function submitInvite(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !inviteEmail.trim()) return;
    void runAction(async () => {
      const result = await addWorkspaceMember(workspaceId, inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      setNotice(result.kind === 'invited'
        ? `Đã gửi email mời đăng ký tới ${result.email}. Người này chưa được thêm vào không gian.`
        : `Đã thêm ${result.member.user.name} vào không gian. Các bảng riêng tư vẫn cần lời mời riêng.`);
      loadMembers();
      loadWorkspace();
      void reloadWorkspaces();
    }, 'Không thêm được thành viên.');
  }

  function changeRole(userId: string, role: AssignableRole) {
    if (!canManage) return;
    void runAction(async () => {
      const updated = await changeWorkspaceMemberRole(workspaceId, userId, role);
      requestSequences.current.members++;
      setMembers((current) => current.map((member) => member.userId === userId ? updated : member));
      setNotice(`Đã đổi vai trò của ${updated.user.name} thành ${roleLabel(role)}.`);
      loadWorkspace();
      void reloadWorkspaces();
      void reloadBoards();
    }, 'Không đổi được vai trò.');
  }

  function doRemove() {
    if (!canManage || !removeTarget) return;
    const target = removeTarget;
    void runAction(async () => {
      await removeWorkspaceMember(workspaceId, target.userId);
      // Invalidate any list request started before the member was removed.
      requestSequences.current.members++;
      setMembers((current) => current.filter((member) => member.userId !== target.userId));
      setRemoveTarget(null);
      if (assigneeFilter === target.userId) filterAssignee('');
      setNotice(`Đã xóa ${target.user.name} khỏi không gian.`);
      loadMembers();
      loadWorkspace();
      void reloadWorkspaces();
    }, 'Không xóa được thành viên.').then(() => setRemoveTarget(null));
  }

  function doTransfer() {
    if (!isOwner || ws?.isPersonal || !transferTarget) return;
    const target = transferTarget;
    void runAction(async () => {
      await transferWorkspaceOwnership(workspaceId, target.userId);
      setTransferTarget(null);
      setNotice(`Đã chuyển quyền sở hữu cho ${target.user.name}.`);
      loadWorkspace();
      loadMembers();
      void reloadWorkspaces();
      void reloadBoards();
    }, 'Không chuyển được quyền sở hữu.').then(() => setTransferTarget(null));
  }

  function doLeave() {
    if (!user || isOwner) return;
    void runAction(async () => {
      await removeWorkspaceMember(workspaceId, user.id);
      removeWorkspace(workspaceId);
      void reloadWorkspaces();
      void reloadBoards();
      navigate('/boards', { replace: true });
    }, 'Không rời được không gian.');
    setConfirmLeave(false);
  }

  function doDelete() {
    if (!isOwner || ws?.isPersonal) return;
    void runAction(async () => {
      await deleteWorkspace(workspaceId);
      removeWorkspace(workspaceId);
      void reloadWorkspaces();
      void reloadBoards();
      navigate('/boards', { replace: true });
    }, 'Không xóa được không gian.');
    setConfirmDelete(false);
  }

  function onCreated(board: Board) {
    upsertBoard(board);
    setCreateOpen(false);
    setNotice(`Đã tạo bảng “${board.name}” trong không gian này.`);
    loadWorkspace();
    refreshOverview();
    void reloadWorkspaces();
    createButtonRef.current?.focus();
  }

  if (loadError) return (
    <div className={PANEL}>
      <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{loadError}</p>
      <button type="button" onClick={loadWorkspace} className={`mt-4 ${SECONDARY_BUTTON}`}>Thử tải lại không gian</button>
      <Link to="/boards" className={`ml-3 rounded text-sm text-primary-ink ${FOCUS}`}>Về danh sách bảng</Link>
    </div>
  );
  if (!ws) return <SkeletonRegion label="Đang tải không gian làm việc…" className="space-y-4"><Skeleton className="h-16 w-64" /><SkeletonRows rows={4} boxed /></SkeletonRegion>;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link to="/boards" className={`inline-flex items-center gap-1.5 rounded text-xs font-medium text-slate-500 hover:text-primary-ink dark:text-slate-400 ${FOCUS}`}><WorkspaceIcon path="M15 18l-6-6 6-6" className="h-3.5 w-3.5" />Tất cả các bảng</Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[var(--brand-accent)] to-primary text-lg font-bold text-white shadow-sm sm:h-14 sm:w-14">{ws.name.slice(0, 1).toLocaleUpperCase('vi')}</span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">{ws.isPersonal ? 'Không gian cá nhân' : 'Không gian nhóm'}</p>
            <h1 className="mt-1 break-words text-xl font-bold text-slate-900 sm:text-2xl dark:text-slate-100">{ws.name}</h1>
            <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{wsBoards.length} bảng truy cập được · {ws.memberCount ?? members.length} thành viên · {roleLabel(myRole)}</p>
          </div>
        </div>
        {tab === 'boards' && <div ref={createRef} className="relative w-full shrink-0 sm:w-auto">
          <button ref={createButtonRef} type="button" disabled={busy} aria-expanded={createOpen} aria-controls="workspace-create-board" onClick={() => setCreateOpen((value) => !value)} className={`w-full ${PRIMARY_BUTTON}`}><WorkspaceIcon path="M12 5v14M5 12h14" />Tạo bảng mới</button>
          <div id="workspace-create-board" hidden={!createOpen} className="absolute right-0 top-[calc(100%+8px)] z-40">
            {createOpen && (
              <Suspense fallback={<ModalLoading />}>
                <CreateBoardDialog workspaceId={ws.id} onClose={() => { setCreateOpen(false); createButtonRef.current?.focus(); }} onCreated={onCreated} className="tf-menu-in max-w-[calc(100vw-2rem)]" />
              </Suspense>
            )}
          </div>
        </div>}
      </header>

      <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{ws.isPersonal ? 'Theo dõi các bảng và công việc của bạn ở một nơi. Thành viên và cấu hình cộng tác nằm trong các mục riêng.' : 'Theo dõi tiến độ các bảng, quản lý thành viên và thiết lập cách cộng tác của nhóm.'}</p>

      <div role="tablist" aria-label="Quản lý không gian" className="grid grid-cols-[1.1fr_1.4fr_0.7fr] gap-1 border-b border-slate-200 sm:flex dark:border-slate-700">
        {TABS.map((item, index) => <button key={item.id} id={`${tabId}-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`${tabId}-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onKeyDown={(event) => onTabKey(event, index)} onClick={() => selectTab(item.id)} className={`flex min-w-0 items-center justify-center gap-2 border-b-2 px-2 py-3 text-[11px] font-semibold transition-colors sm:px-4 sm:text-sm ${FOCUS} ${tab === item.id ? 'border-primary text-primary-ink' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}><WorkspaceIcon path={item.icon} className="hidden h-4 w-4 sm:block" />{item.label}</button>)}
      </div>

      {actionError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{actionError}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">{notice}</p>}

      {TABS.map((item) => <div key={item.id} role="tabpanel" id={`${tabId}-panel-${item.id}`} aria-labelledby={`${tabId}-${item.id}`} hidden={tab !== item.id} tabIndex={0} className={`rounded-xl ${FOCUS}`}>
        {tab === item.id && <>
          {item.id === 'boards' && <WorkspaceBoardsPanel
            boards={wsBoards} boardCount={ws.boardCount} boardsLoading={boardsLoading} boardsError={boardsError}
            onReloadBoards={() => void reloadBoards()}
            onCreate={() => { setCreateOpen(true); createButtonRef.current?.scrollIntoView({ block: 'nearest' }); }}
            overview={overview} overviewLoading={overviewLoading} overviewError={overviewError} onReloadOverview={refreshOverview}
            members={members} assigneeFilter={assigneeFilter} onAssigneeFilter={filterAssignee}
            statusFilter={statusFilter} onStatusFilter={filterStatus}
          />}
          {item.id === 'members' && <WorkspaceMembersPanel
            workspace={ws} members={members} loading={membersLoading} error={membersError} onReload={refreshMembers}
            userId={user?.id} canManage={canManage} isOwner={isOwner} cvIds={cvIds} busy={busy}
            inviteEmail={inviteEmail} onInviteEmail={setInviteEmail} inviteRole={inviteRole} onInviteRole={setInviteRole}
            onInvite={submitInvite} onChangeRole={changeRole} onRemove={setRemoveTarget} onTransfer={setTransferTarget}
          />}
          {item.id === 'settings' && <WorkspaceSettingsPanel
            workspace={ws} canManage={canManage} isOwner={isOwner} busy={busy}
            nameDraft={nameDraft} onNameDraft={setNameDraft} onSaveName={saveName}
            onLeave={() => setConfirmLeave(true)} onDelete={() => setConfirmDelete(true)}
          />}
        </>}
      </div>)}

      <ConfirmDialog open={removeTarget !== null} title="Xóa thành viên khỏi không gian?" message={removeTarget ? `${removeTarget.user.name} sẽ mất quyền truy cập qua không gian. Quyền được cấp trực tiếp trong từng bảng được giữ lại.` : undefined} confirmLabel="Xóa thành viên" danger busy={busy} onConfirm={doRemove} onCancel={() => setRemoveTarget(null)} />
      <ConfirmDialog open={transferTarget !== null} title="Chuyển quyền sở hữu không gian" message={transferTarget ? `${transferTarget.user.name} sẽ trở thành chủ không gian. Bạn sẽ trở thành quản trị viên.` : undefined} confirmLabel="Chuyển quyền" danger busy={busy} onConfirm={doTransfer} onCancel={() => setTransferTarget(null)} />
      <ConfirmDialog open={confirmLeave} title="Rời khỏi không gian?" message="Bạn sẽ mất quyền truy cập qua không gian. Quyền được cấp trực tiếp trong từng bảng được giữ lại." confirmLabel="Rời khỏi" danger busy={busy} onConfirm={doLeave} onCancel={() => setConfirmLeave(false)} />
      <ConfirmDialog open={confirmDelete} title="Xóa không gian?" message={`Chỉ xóa được không gian “${ws.name}” khi không còn bảng bên trong.`} confirmLabel="Xóa không gian" danger busy={busy} onConfirm={doDelete} onCancel={() => setConfirmDelete(false)} />
    </div>
  );
}
