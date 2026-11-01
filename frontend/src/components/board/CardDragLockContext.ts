import { createContext, useContext } from 'react';
import type { CardDragLock } from '../../lib/cardDragLock';

const NONE: ReadonlyMap<string, CardDragLock> = new Map();

// Các thẻ đang bị NGƯỜI KHÁC kéo (không gồm chính mình), theo id thẻ.
// Truyền qua context như CardHighlightContext để không phải luồn prop qua ListColumn -> CardItem.
export const CardDragLockContext = createContext<ReadonlyMap<string, CardDragLock>>(NONE);

export function useCardDragLock(cardId: string): CardDragLock | undefined {
  return useContext(CardDragLockContext).get(cardId);
}
