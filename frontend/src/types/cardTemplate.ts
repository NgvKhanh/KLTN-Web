export interface CardTemplateItem {
  id: string;
  content: string;
  position: number;
}

export interface CardTemplateChecklist {
  id: string;
  title: string;
  position: number;
  items: CardTemplateItem[];
}

export interface CardTemplate {
  id: string;
  boardId: string;
  name: string;
  description: string | null;
  createdAt: string;
  checklists: CardTemplateChecklist[];
}
