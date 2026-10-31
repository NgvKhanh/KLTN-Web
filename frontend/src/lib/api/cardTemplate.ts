import { api } from '../axios';
import type { Card } from '../../types/card';
import type { CardTemplate } from '../../types/cardTemplate';

export async function fetchCardTemplates(boardId: string): Promise<CardTemplate[]> {
  const res = await api.get<{ data: { templates: CardTemplate[] } }>(
    `/boards/${boardId}/card-templates`
  );
  return res.data.data.templates;
}

export async function createCardTemplate(
  boardId: string,
  input: {
    name: string;
    description?: string;
    checklists?: { title: string; items?: string[] }[];
  }
): Promise<CardTemplate> {
  const res = await api.post<{ data: { template: CardTemplate } }>(
    `/boards/${boardId}/card-templates`,
    input
  );
  return res.data.data.template;
}

// Chup 1 the dang co thanh mau, luu vao bang chua no.
export async function saveCardAsTemplate(
  cardId: string,
  name?: string
): Promise<CardTemplate> {
  const res = await api.post<{ data: { template: CardTemplate } }>(
    `/cards/${cardId}/save-as-template`,
    name ? { name } : {}
  );
  return res.data.data.template;
}

export async function deleteCardTemplate(templateId: string): Promise<void> {
  await api.delete(`/card-templates/${templateId}`);
}

export async function applyCardTemplate(
  listId: string,
  templateId: string,
  title?: string
): Promise<Card> {
  const res = await api.post<{ data: { card: Card } }>(
    `/lists/${listId}/cards/from-template/${templateId}`,
    title ? { title } : {}
  );
  return res.data.data.card;
}
