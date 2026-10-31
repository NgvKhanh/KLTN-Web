import type { WorkspaceRole } from '../../types/workspace';

export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900';
export const PANEL = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-700 dark:bg-slate-800';
export const INPUT = 'min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
export const PRIMARY_BUTTON = `inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const SECONDARY_BUTTON = `inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 ${FOCUS}`;

export function roleLabel(role: WorkspaceRole) {
  return role === 'OWNER' ? 'Chủ không gian' : role === 'ADMIN' ? 'Quản trị viên' : 'Thành viên';
}
