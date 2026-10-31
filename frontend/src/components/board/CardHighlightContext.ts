import { createContext, useContext } from 'react';

/** Hiệu ứng tạm thời của một thẻ trên bảng: hiện ra (enter) và/hoặc viền nổi bật (flash). */
export interface CardHighlight {
  enter: boolean;
  flash: boolean;
}

const NONE: ReadonlyMap<string, CardHighlight> = new Map();

// Truyền qua context để không phải luồn prop qua ListColumn -> CardItem.
export const CardHighlightContext = createContext<ReadonlyMap<string, CardHighlight>>(NONE);

export function useCardHighlight(cardId: string): CardHighlight | undefined {
  return useContext(CardHighlightContext).get(cardId);
}
