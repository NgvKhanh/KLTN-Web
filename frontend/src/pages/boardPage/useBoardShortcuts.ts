import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { EMPTY_FILTER, type BoardFilter } from '../../lib/boardFilter';

interface Options {
  /** Dang mo modal the -> chi giu phim '?' */
  cardOpen: boolean;
  shortcutsOpen: boolean;
  readOnly: boolean;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  setFilterOpen: Dispatch<SetStateAction<boolean>>;
  setBgMenuOpen: Dispatch<SetStateAction<boolean>>;
  setFilter: Dispatch<SetStateAction<BoardFilter>>;
}

/**
 * Phim tat cua trang bang. Tach khoi BoardPage cho gon; hanh vi giu nguyen:
 *  ? -> bang phim tat | n -> them the | f -> bo loc | b -> anh nen
 *  x -> xoa loc       | q -> loc "viec cua toi"
 * Bo qua khi dang go trong input/textarea/select/contentEditable.
 */
export function useBoardShortcuts({
  cardOpen,
  shortcutsOpen,
  readOnly,
  setShortcutsOpen,
  setFilterOpen,
  setBgMenuOpen,
  setFilter,
}: Options) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const typing =
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable);
      if (typing) return;

      // '?' luon dung duoc (ke ca khi mo the)
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      // Dang mo modal the hoac bang phim tat -> bo qua cac phim con lai
      if (cardOpen || shortcutsOpen) return;

      switch (e.key.toLowerCase()) {
        case 'n': {
          e.preventDefault();
          const btn =
            document.querySelector<HTMLButtonElement>('[data-add-card]');
          btn?.scrollIntoView({ block: 'nearest', inline: 'center' });
          btn?.click();
          break;
        }
        case 'f':
          e.preventDefault();
          setFilterOpen((v) => !v);
          break;
        case 'b':
          e.preventDefault();
          if (!readOnly) setBgMenuOpen((v) => !v);
          break;
        case 'x':
          e.preventDefault();
          setFilter(EMPTY_FILTER);
          break;
        case 'q':
          e.preventDefault();
          setFilter((f) => ({
            ...EMPTY_FILTER,
            ...f,
            assignedToMe: !f.assignedToMe,
          }));
          break;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    cardOpen,
    shortcutsOpen,
    readOnly,
    setShortcutsOpen,
    setFilterOpen,
    setBgMenuOpen,
    setFilter,
  ]);
}
