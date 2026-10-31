import { api } from '../axios';
import type { CardStatus } from '../../types/card';
import type { SearchCard } from './card';

export type AssigneeFilter = 'me' | 'unassigned';
export type StatusFilter = 'all' | 'active' | 'done';

export interface SearchFilterParams {
  q?: string;
  assignee?: AssigneeFilter;
  labelName?: string;
  // Muc hoan thanh (chua xong / da xong)
  status?: StatusFilter;
  // Trang thai cong viec, chon nhieu (khop 1 trong so do)
  statuses?: CardStatus[];
  overdue?: boolean;
  dueFrom?: string;
  dueTo?: string;
}

// Ket qua tim kiem nang cao co them trang thai cong viec
export type AdvancedSearchCard = SearchCard & { status: CardStatus };

export interface SearchCardsResult {
  items: AdvancedSearchCard[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

function buildQuery(params: SearchFilterParams, page: number): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.assignee) qs.set('assignee', params.assignee);
  if (params.labelName) qs.set('labelName', params.labelName);
  if (params.status && params.status !== 'all') qs.set('status', params.status);
  if (params.statuses && params.statuses.length > 0) qs.set('statuses', params.statuses.join(','));
  if (params.overdue) qs.set('overdue', 'true');
  if (params.dueFrom) qs.set('dueFrom', params.dueFrom);
  if (params.dueTo) qs.set('dueTo', params.dueTo);
  qs.set('page', String(page));
  return qs.toString();
}

export async function searchCardsAdvanced(
  params: SearchFilterParams,
  page = 1
): Promise<SearchCardsResult> {
  const res = await api.get<{ data: SearchCardsResult }>(
    `/search/cards?${buildQuery(params, page)}`
  );
  return res.data.data;
}

export interface SavedFilter {
  id: string;
  userId: string;
  name: string;
  params: SearchFilterParams;
  createdAt: string;
}

export async function fetchSavedFilters(): Promise<SavedFilter[]> {
  const res = await api.get<{ data: { filters: SavedFilter[] } }>(
    '/search/filters'
  );
  return res.data.data.filters;
}

export async function saveFilter(
  name: string,
  params: SearchFilterParams
): Promise<SavedFilter> {
  const res = await api.post<{ data: { filter: SavedFilter } }>(
    '/search/filters',
    { name, params }
  );
  return res.data.data.filter;
}

export async function deleteSavedFilter(filterId: string): Promise<void> {
  await api.delete(`/search/filters/${filterId}`);
}
