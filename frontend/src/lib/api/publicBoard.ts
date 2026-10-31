import { api } from '../axios';
import type {
  PublicBoard,
  PublicCardDetail,
  PublicList,
} from '../../types/publicBoard';

// Xem bang PUBLIC khong can dang nhap - khong gui kem thao tac ghi nao.
export async function fetchPublicBoard(boardId: string): Promise<PublicBoard> {
  const res = await api.get<{ data: { board: PublicBoard } }>(
    `/public/boards/${boardId}`
  );
  return res.data.data.board;
}

export async function fetchPublicBoardLists(
  boardId: string
): Promise<PublicList[]> {
  const res = await api.get<{ data: { lists: PublicList[] } }>(
    `/public/boards/${boardId}/lists`
  );
  return res.data.data.lists;
}

export async function fetchPublicCard(
  cardId: string
): Promise<PublicCardDetail> {
  const res = await api.get<{ data: { card: PublicCardDetail } }>(
    `/public/cards/${cardId}`
  );
  return res.data.data.card;
}
