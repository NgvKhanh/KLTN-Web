import { api } from '../axios';
import type { Board } from '../../types/board';
import type { UserBoardTemplate } from '../../types/boardTemplate';

export async function fetchUserBoardTemplates(
  workspaceId: string
): Promise<UserBoardTemplate[]> {
  const res = await api.get<{ data: { templates: UserBoardTemplate[] } }>(
    `/workspaces/${workspaceId}/board-templates`
  );
  return res.data.data.templates;
}

// Chup 1 bang dang co thanh mau, luu vao khong gian chua no.
export async function saveBoardAsTemplate(
  boardId: string,
  name?: string
): Promise<UserBoardTemplate> {
  const res = await api.post<{ data: { template: UserBoardTemplate } }>(
    `/boards/${boardId}/save-as-template`,
    name ? { name } : {}
  );
  return res.data.data.template;
}

export async function deleteUserBoardTemplate(templateId: string): Promise<void> {
  await api.delete(`/boards/templates/${templateId}`);
}

export async function createBoardFromUserTemplate(
  workspaceId: string,
  templateId: string,
  name?: string
): Promise<Board> {
  const res = await api.post<{ data: { board: Board } }>(
    '/boards/from-saved-template',
    { workspaceId, templateId, ...(name ? { name } : {}) }
  );
  return res.data.data.board;
}
