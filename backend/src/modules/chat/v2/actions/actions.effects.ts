// HIEU UNG PHU cua mot ke hoach - gom trong BO NHO, CHI phat SAU KHI transaction COMMIT (CHATBOT_V2_ACTIONS_PLAN.md, Phase 2).
//
// Trong transaction chi co viec ghi CSDL (du lieu + Activity). Thong bao, tu dong hoa va su kien socket la hieu ung ra ngoai: neu
// transaction rollback thi KHONG thong bao ai, khong phat gi - nguoi dung khong bao gio thay "thẻ đã chuyển" cho mot thao tac khong xay ra.
// Day la outbox trong bo nho (khong luu bang): neu tien trinh chet dung giua COMMIT va luc phat thi mat thong bao / socket, nhung du lieu
// va Activity (da nam trong transaction) van day du. Cac service ghi tay hien tai cung phat thong bao theo kieu "ban roi quen" nen
// do tin cay tuong duong.

import { emitToBoard } from '../../../../realtime/socket';
import { runAutomationsForCard } from '../../../automation/automation.service';
import { cardMemberIds, notify, type NotificationType } from '../../../notification/notification.service';
import { removeCardAttachmentFile } from '../../../../config/upload';
import { releaseStaged } from '../uploads/chat.uploads';

/** Ai nhan thong bao: nhung nguoi dang la thanh vien / theo doi the LUC PHAT (tru `exclude`), hoac danh sach cu the. */
export type NotifyTarget = { kind: 'MEMBERS'; cardId: string; exclude: readonly string[] } | { kind: 'USERS'; ids: readonly string[] };

export interface NotificationJob {
  type: NotificationType;
  actorId: string;
  boardId: string;
  /** null: thong bao khong gan voi the (the da bi xoa nen khong co lien ket de mo), giong deleteCard. */
  cardId: string | null;
  data: Record<string, unknown>;
  to: NotifyTarget;
}

export interface AutomationJob {
  trigger: 'CARD_CREATED' | 'CARD_MOVED_TO_LIST';
  cardId: string;
  cardTitle: string;
  boardId: string;
  listId: string;
}

/** Mot dong Activity DA duoc ghi trong transaction (chi de bao cao). */
export interface ActivityRecord {
  type: string;
  cardId: string | null;
}

export interface Effects {
  activities: ActivityRecord[];
  notifications: NotificationJob[];
  automations: AutomationJob[];
  /** Bang can bao realtime: MOT su kien moi bang cho ca ke hoach (thao tac tay phat nhieu su kien). */
  boardIds: Set<string>;
  /**
   * Tep tren dia: `adopted` = tep da chep vao thu muc tep the TRONG transaction (xoa neu transaction hoan tac); `release` = id tep tam can don SAU commit;
   * `remove` = duong dan tep cua the can xoa SAU commit (go tep dinh kem).
   */
  files: { adopted: string[]; release: string[]; remove: string[] };
  /**
   * Hieu ung rieng cua thao tac quan tri (su kien socket toi tung nguoi, don anh nen bang...). Chay SAU COMMIT, dung thu tu them vao; mot ham loi
   * chi duoc ghi log. Khong bao gio chay khi transaction hoan tac.
   */
  afterCommit: Array<() => void | Promise<void>>;
}

export const newEffects = (): Effects => ({ activities: [], notifications: [], automations: [], boardIds: new Set(), files: { adopted: [], release: [], remove: [] }, afterCommit: [] });

/** Transaction hoan tac: bo cac tep da chep vao thu muc tep the (khong de tep mo coi). */
export function discardAdopted(effects: Effects): void {
  for (const publicPath of effects.files.adopted) removeCardAttachmentFile(publicPath);
}

export interface DispatchReport {
  notifications: number;
  automations: number;
  sockets: number;
  failed: number;
}

/**
 * Phat hieu ung SAU COMMIT, dung thu tu thao tac. Moi hieu ung la "co gang het suc": mot hieu ung loi chi duoc ghi log, khong lam hong
 * ket qua (du lieu da commit). Thong bao truoc, tu dong hoa sau, socket cuoi cung (de client tai lai dung MOT lan sau khi moi thu xong).
 */
export async function dispatchEffects(effects: Effects): Promise<DispatchReport> {
  const report: DispatchReport = { notifications: 0, automations: 0, sockets: 0, failed: 0 };
  for (const job of effects.notifications) {
    try {
      const to = job.to;
      const recipients = to.kind === 'USERS' ? [...to.ids] : (await cardMemberIds(to.cardId)).filter((id) => !to.exclude.includes(id));
      await notify({ recipients, actorId: job.actorId, type: job.type, boardId: job.boardId, ...(job.cardId !== null ? { cardId: job.cardId } : {}), data: job.data });
      report.notifications += 1;
    } catch (e) {
      report.failed += 1;
      console.error('[chat-actions] gui thong bao that bai:', e);
    }
  }
  for (const job of effects.automations) {
    try {
      await runAutomationsForCard(job.trigger, job.cardId, job.cardTitle, job.boardId, job.listId);
      report.automations += 1;
    } catch (e) {
      report.failed += 1;
      console.error('[chat-actions] chay tu dong hoa that bai:', e);
    }
  }
  for (const id of effects.files.release) await releaseStaged(id).catch(() => undefined);
  for (const publicPath of effects.files.remove) removeCardAttachmentFile(publicPath);
  for (const boardId of effects.boardIds) {
    try {
      emitToBoard(boardId, 'board:lists-changed');
      report.sockets += 1;
    } catch (e) {
      report.failed += 1;
      console.error('[chat-actions] phat socket that bai:', e);
    }
  }
  for (const run of effects.afterCommit) {
    try {
      await run();
      report.sockets += 1;
    } catch (e) {
      report.failed += 1;
      console.error('[chat-actions] hieu ung quan tri that bai:', e);
    }
  }
  return report;
}
