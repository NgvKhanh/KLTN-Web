// REGISTRY cac thao tac mo rong (buoc E-I). Cac loi (refs, resolve, guard, write, plan, provenance, autorun) tra cuu o day theo `type`; thao tac nao
// khong co handler thi la thao tac cu, di qua cac `switch` cu cua tung tep.

import { ATTACHMENT_HANDLERS } from './ops.attachment';
import { BOARD_HANDLERS } from './ops.board';
import { CARD_EXTRA_HANDLERS } from './ops.cardextras';
import { CHECKLIST_HANDLERS } from './ops.checklist';
import { CLEANUP_HANDLERS } from './ops.cleanup';
import { COMMENT_HANDLERS } from './ops.comments';
import type { AnyHandler } from './ops.types';

const ALL: readonly AnyHandler[] = [...CLEANUP_HANDLERS, ...COMMENT_HANDLERS, ...CHECKLIST_HANDLERS, ...ATTACHMENT_HANDLERS, ...CARD_EXTRA_HANDLERS, ...BOARD_HANDLERS];

const BY_TYPE = new Map<string, AnyHandler>(ALL.map((h) => [h.type, h]));

/** Handler cua mot loai thao tac mo rong (undefined = thao tac cu hoac khong ton tai). */
export function handlerOf(type: string): AnyHandler | undefined {
  return BY_TYPE.get(type);
}

/** Moi loai thao tac mo rong da dang ky (de test kiem tra khong sot loai nao trong ACTION_TYPES). */
export const EXTENDED_TYPES: readonly string[] = [...BY_TYPE.keys()];

/** 18 thao tac cu: nam trong cac `switch` cu, KHONG di qua registry. */
export const LEGACY_TYPES: readonly string[] = [
  'CREATE_LIST',
  'CREATE_CARD',
  'RENAME_CARD',
  'SET_CARD_DUE',
  'MOVE_CARD',
  'SET_CARD_STATUS',
  'ASSIGN_MEMBER',
  'ADD_LABEL',
  'ASSIGN_UNASSIGNED',
  'CREATE_AUTOMATION_RULE',
  'SET_CARD_DESCRIPTION',
  'SET_CARD_START',
  'ADD_COMMENT',
  'ADD_CHECKLIST',
  'REMOVE_MEMBER',
  'REMOVE_LABEL',
  'RENAME_LIST',
  'ARCHIVE_CARD',
];
