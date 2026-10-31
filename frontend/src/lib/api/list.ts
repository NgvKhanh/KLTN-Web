import { api } from '../axios';
import type { CardStatus } from '../../types/card';
import type { BoardList } from '../../types/list';

export async function fetchBoardLists(boardId: string): Promise<BoardList[]> {
  const res = await api.get<{ data: { lists: BoardList[] } }>(
    `/boards/${boardId}/lists`
  );
  return res.data.data.lists;
}

export async function createList(
  boardId: string,
  name: string
): Promise<BoardList> {
  const res = await api.post<{ data: { list: BoardList } }>(
    `/boards/${boardId}/lists`,
    { name }
  );
  return res.data.data.list;
}

export async function updateList(
  listId: string,
  // status: gan trang thai cot (null = cot tu do) - cac the trong cot doi theo
  input: { name?: string; position?: number; status?: CardStatus | null }
): Promise<BoardList> {
  const res = await api.patch<{ data: { list: BoardList } }>(
    `/lists/${listId}`,
    input
  );
  return res.data.data.list;
}

// Keo sap xep lai cot: dua cot toi vi tri index (tu 0)
export async function reorderList(
  listId: string,
  position: number
): Promise<void> {
  await api.patch(`/lists/${listId}`, { position });
}

export async function deleteList(listId: string): Promise<void> {
  await api.delete(`/lists/${listId}`);
}

// Luu tru / khoi phuc / xoa han danh sach
export async function archiveList(listId: string): Promise<void> {
  await api.post(`/lists/${listId}/archive`);
}
export async function restoreList(listId: string): Promise<void> {
  await api.post(`/lists/${listId}/restore`);
}
export async function purgeList(listId: string): Promise<void> {
  await api.delete(`/lists/${listId}/purge`);
}

// Sao chep danh sach (kem toan bo the), chen ngay sau danh sach goc
export async function copyList(listId: string): Promise<BoardList> {
  const res = await api.post<{ data: { list: BoardList } }>(
    `/lists/${listId}/copy`
  );
  return res.data.data.list;
}

// Chuyen toan bo the sang danh sach khac cung bang
export async function moveAllCards(
  listId: string,
  targetListId: string
): Promise<void> {
  await api.post(`/lists/${listId}/move-all-cards`, { targetListId });
}

export type SortListBy = 'created-desc' | 'created-asc' | 'title-asc' | 'done';

// Sap xep lai the trong danh sach
export async function sortListCards(
  listId: string,
  by: SortListBy
): Promise<void> {
  await api.patch(`/lists/${listId}/sort`, { by });
}

// Xoa toan bo the trong danh sach
export async function deleteAllCards(listId: string): Promise<void> {
  await api.delete(`/lists/${listId}/cards`);
}

// Theo doi / bo theo doi danh sach: nhan thong bao hoat dong cua moi the trong do
export async function fetchListWatch(listId: string): Promise<boolean> {
  const res = await api.get<{ data: { watching: boolean } }>(
    `/lists/${listId}/watch`
  );
  return res.data.data.watching;
}
export async function setListWatch(
  listId: string,
  watching: boolean
): Promise<void> {
  await api.put(`/lists/${listId}/watch`, { watching });
}
