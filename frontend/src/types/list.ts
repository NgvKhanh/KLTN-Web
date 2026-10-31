import type { Card, CardStatus } from './card';

// Danh sach (cot) trong bang
export interface BoardList {
  id: string;
  boardId: string;
  name: string;
  position: number;
  // Trang thai gan cho cot (the di vao cot se doi theo); null = cot tu do
  status: CardStatus | null;
  createdAt: string;
  updatedAt: string;
  cards: Card[];
}
