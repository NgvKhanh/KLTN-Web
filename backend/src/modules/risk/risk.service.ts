// Dich vu canh bao nguy co tre han (RISK_MODULE.md §8, §10, §12): vong quet, luu ket qua, thong bao + email, API doc.

import { env } from '../../config/env';
import { sendMail } from '../../config/mailer';
import { prisma } from '../../config/prisma';
import { emitToBoard, emitToUser } from '../../realtime/socket';
import { riskWarningEmail } from '../auth/emailTemplates';
import { canManageBoard } from '../board/board.service';
import { assertCardView } from '../card/card.service';
import { boardManagerIds, cardMemberIds } from '../notification/notification.service';
import { preferencesFor } from '../notification/notificationPreference.service';
import { decideNotify, isRiskFresh } from './risk.decide';
import { PERSONAL_REASONS, RULES_VERSION, assessWithModel, assessWithRules, type RiskAssessment, type RiskReason } from './risk.explain';
import { buildRiskContext, extractFeatures, type ExtractedFeatures, type RiskPriors } from './risk.features';
import { RISK_EMAIL_DAILY_CAP, type RiskLevel } from './risk.levels';
import { validateModelFile } from './risk.model';
import { readScanCandidates, readWorkspaceHistories, type ScanCandidate } from './risk.repo';
// Buoc 18 (§21.5): bo quet dung mo hinh 4 yeu to `logreg-v3` - user chot 31/10 du P2v3 truot sat nut. Tep v1, v2 van giu de tai
// lap / so sanh; quay lai chi can doi dong import nay (luot quet dau voi phien ban moi tu im lang).
import modelJson from './model/risk-model.v3.json';

/** Du phong khi tep mo hinh hong (luat co dinh van can priors cho the cua khong gian chua co lich su). */
export const DEFAULT_PRIORS: RiskPriors = { lateRate: 0.3, daysPerPoint: 2 };

export interface RiskScorer {
  version: string;
  priors: RiskPriors;
  assess: (f: ExtractedFeatures) => RiskAssessment;
}

/** Nap tep mo hinh; hong / lech dac trung -> luat co dinh + ghi log (§6.1: khong de mo hinh chay am tham voi dac trung lech). */
export function loadScorer(raw: unknown = modelJson): RiskScorer {
  try {
    const m = validateModelFile(raw);
    return { version: m.version, priors: m.priors, assess: (f) => assessWithModel(m, m.version, f) };
  } catch (err) {
    console.error('[risk] tep mo hinh khong dung duoc, chuyen sang luat co dinh:', err);
    return { version: RULES_VERSION, priors: DEFAULT_PRIORS, assess: assessWithRules };
  }
}

let cachedScorer: RiskScorer | null = null;
export function riskScorer(): RiskScorer {
  cachedScorer ??= loadScorer();
  return cachedScorer;
}

/** Nguoi nhan (§8.4): thanh vien the + nguoi theo doi the / cot / bang (da loc quyen xem) + chu / quan tri bang. */
export async function riskRecipients(cardId: string, boardId: string): Promise<string[]> {
  const [members, managers] = await Promise.all([cardMemberIds(cardId), boardManagerIds(boardId)]);
  return [...new Set([...members, ...managers])];
}

export interface ScanSummary {
  candidates: number;
  scored: number;
  notifications: number;
  removed: number;
  bootstrap: boolean;
}

/**
 * Mot vong quet (§8.1). Loi cua mot the / mot khong gian khong lam hong ca vong.
 * "Lan quet dau" tinh THEO PHIEN BAN MO HINH (§8.3, §20.5): chua co dong nhat ky nao mang `scorer.version` -> chi ghi, khong gui.
 * Lan bat module dau tien va lan doi mo hinh (diem nhieu the nhay cung luc) deu im lang.
 */
export async function runRiskScan(now: Date = new Date(), scorer: RiskScorer = riskScorer()): Promise<ScanSummary> {
  const bootstrap = (await prisma.cardRiskEvent.findFirst({ where: { modelVersion: scorer.version }, select: { id: true } })) === null;
  const candidates = await readScanCandidates(now);
  const summary: ScanSummary = { candidates: candidates.length, scored: 0, notifications: 0, removed: 0, bootstrap };

  const byWorkspace = new Map<string, ScanCandidate[]>();
  for (const c of candidates) byWorkspace.set(c.workspaceId, [...(byWorkspace.get(c.workspaceId) ?? []), c]);

  for (const [workspaceId, list] of byWorkspace) {
    try {
      const histories = await readWorkspaceHistories(workspaceId);
      const byId = new Map(histories.map((h) => [h.id, h]));
      const ctx = buildRiskContext(histories, now, scorer.priors, 'live');
      for (const c of list) {
        const h = byId.get(c.cardId);
        if (!h) continue;
        const f = extractFeatures(h, ctx);
        if (!f) continue;
        try {
          summary.notifications += await applyAssessment(c, f, scorer.assess(f), now, bootstrap);
          summary.scored += 1;
        } catch (err) {
          console.error('[risk] cham / luu the that bai, se thu lai vong sau:', c.cardId, err);
        }
      }
    } catch (err) {
      console.error('[risk] quet khong gian that bai:', workspaceId, err);
    }
  }

  // Dong moc (khong gan the) cho phien ban nay: vong sau het im lang ke ca khi vong nay khong the nao doi muc
  if (bootstrap) {
    await prisma.cardRiskEvent.create({ data: { toLevel: 'SAFE', score: 0, dueDate: now, recipients: 0, modelVersion: scorer.version } });
  }

  // The da ra khoi pham vi (xong, luu tru, xoa, doi han ra xa) -> xoa ket qua; nhat ky CardRiskEvent van con
  const removed = await prisma.cardRisk.deleteMany({ where: { cardId: { notIn: candidates.map((c) => c.cardId) } } });
  summary.removed = removed.count;
  return summary;
}

/** Luu ket qua cua 1 the + quyet dinh bao (§8.3). Tra ve so thong bao da tao. */
async function applyAssessment(c: ScanCandidate, f: ExtractedFeatures, a: RiskAssessment, now: Date, bootstrap: boolean): Promise<number> {
  const decision = decideNotify(c.risk, a, { dueDate: c.dueDate, now, bootstrap });
  const recipients = decision.notify ? await riskRecipients(c.cardId, c.boardId) : [];
  const data = {
    score: a.score,
    level: a.level,
    reasons: a.reasons as unknown as object,
    features: { values: f.values, detail: f.detail } as unknown as object,
    dueDateUsed: c.dueDate,
    modelVersion: a.modelVersion,
    computedAt: now,
    notifiedLevel: decision.notifiedLevel,
    notifiedAt: decision.notify ? now : (c.risk?.notifiedAt ?? null),
  };

  // Ghi ket qua + thong bao + nhat ky trong CUNG 1 transaction. "computedAt nhu luc doc" la dieu kien CAS: hai tien trinh quet
  // cung luc thi chi mot ben ghi duoc (ben kia count = 0 -> bo qua), khong bao trung.
  const written = await prisma.$transaction(async (tx) => {
    if (c.risk) {
      const r = await tx.cardRisk.updateMany({ where: { cardId: c.cardId, computedAt: c.risk.computedAt }, data });
      if (r.count === 0) return false;
    } else {
      await tx.cardRisk.create({ data: { cardId: c.cardId, ...data } });
    }
    if (recipients.length > 0) {
      await tx.notification.createMany({
        data: recipients.map((userId) => ({
          userId,
          actorId: userId, // thong bao he thong (giong nhac han): khong co "nguoi thuc hien"
          type: 'card.risk.warning',
          boardId: c.boardId,
          cardId: c.cardId,
          // kind quyet dinh cau hien thi ("co nguy co tre han" / "da tre han"); level, score chi luu, khong hien
          data: { cardTitle: c.title, kind: decision.kind, level: a.level, score: a.score, dueDate: c.dueDate.toISOString() },
        })),
      });
    }
    if (decision.levelChanged) {
      await tx.cardRiskEvent.create({
        data: {
          cardId: c.cardId,
          fromLevel: c.risk?.level ?? null,
          toLevel: a.level,
          score: a.score,
          dueDate: c.dueDate,
          recipients: recipients.length,
          modelVersion: a.modelVersion,
        },
      });
    }
    return true;
  });
  if (!written) return 0;

  if (decision.levelChanged) emitToBoard(c.boardId, 'board:lists-changed');
  if (recipients.length > 0) await deliver(c, decision.kind === 'overdue', recipients, now);
  return recipients.length;
}

/** Bao realtime cho nguoi bat trong app; gui email cho nguoi bat email, trong gioi han moi ngay. Loi gui mail khong lam hong vong quet. */
async function deliver(c: ScanCandidate, overdue: boolean, recipients: string[], now: Date): Promise<void> {
  const prefs = await preferencesFor(recipients);
  const emailTo = recipients.filter((id) => prefs.get(id)?.riskEmail !== false);
  for (const id of recipients) if (prefs.get(id)?.riskInApp !== false) emitToUser(id, 'notification:new', {});
  if (emailTo.length === 0) return;
  const users = await prisma.user.findMany({ where: { id: { in: emailTo } }, select: { id: true, email: true, name: true } });
  const since = new Date(now.getTime() - 24 * 3_600_000);
  for (const u of users) {
    try {
      // Dem ca thong bao vua tao -> nguoi thu (CAP + 1) trong 24 gio khong con nhan email
      const sent = await prisma.notification.count({ where: { userId: u.id, type: 'card.risk.warning', createdAt: { gte: since } } });
      if (sent > RISK_EMAIL_DAILY_CAP) continue;
      const { subject, html } = riskWarningEmail({
        name: u.name,
        cardTitle: c.title,
        boardName: c.boardName,
        dueDate: c.dueDate,
        overdue,
        url: `${env.frontendUrl}/boards/${c.boardId}?card=${c.cardId}`,
      });
      await sendMail({ to: u.email, subject, html });
    } catch (err) {
      console.error('[risk] gui email that bai:', u.id, err);
    }
  }
}

// ---------- Doc ----------
export interface CardRiskView {
  score: number;
  level: RiskLevel;
  reasons: (RiskReason & { masked?: boolean })[];
  computedAt: string;
  modelVersion: string;
}

/**
 * GET /api/cards/:cardId/risk. Quyen xem the. Ly do nhac toi NGUOI (Q2): chi nguoi duoc giao + nguoi quan ly bang thay so lieu,
 * nguoi khac nhan { code, params: {}, masked: true } (giao dien ghi cau trung tinh). Khong bao gio tra `features`.
 */
export async function getCardRisk(userId: string, cardId: string): Promise<CardRiskView | null> {
  await assertCardView(userId, cardId);
  const card = await prisma.card.findUniqueOrThrow({
    where: { id: cardId },
    select: {
      isDone: true,
      archivedAt: true,
      dueDate: true,
      members: { select: { userId: true } },
      list: { select: { board: { select: { id: true, ownerId: true, workspaceId: true } } } },
      risk: { select: { score: true, level: true, reasons: true, computedAt: true, modelVersion: true, dueDateUsed: true } },
    },
  });
  // The / cot / bang da luu tru: assertCardView o tren da tra 404 (cai loi buoc 6 cho thay kiem lai o day la ma chet)
  if (!isRiskFresh(card.risk, card)) return null;
  const risk = card.risk!;
  const privileged = card.members.some((m) => m.userId === userId) || (await canManageBoard(userId, card.list.board));
  const reasons = (risk.reasons as unknown as RiskReason[]).map((r) =>
    PERSONAL_REASONS.has(r.code) && !privileged ? { code: r.code, params: {}, masked: true } : r
  );
  return { score: risk.score, level: risk.level, reasons, computedAt: risk.computedAt.toISOString(), modelVersion: risk.modelVersion };
}
