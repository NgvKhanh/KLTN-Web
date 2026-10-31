// Buoc 6 module canh bao tre han (RISK_MODULE.md §8, §10, §12): vong quet THAT tren CSDL test, thong bao, email, API, du lieu cot.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rt = vi.hoisted(() => ({ emitToBoard: vi.fn(), emitToUser: vi.fn() }));
vi.mock('../src/realtime/socket', async (original) => ({ ...(await original<object>()), emitToBoard: rt.emitToBoard, emitToUser: rt.emitToUser }));

import { sendMail } from '../src/config/mailer';
import { prisma } from '../src/config/prisma';
import { runRiskScan, type RiskScorer } from '../src/modules/risk/risk.service';
import { levelOf } from '../src/modules/risk/risk.levels';
import type { RiskReason } from '../src/modules/risk/risk.explain';
import { addMember, agent, makeBoard, makeCard, makeDirectUser, makeList, type TestUser } from './helpers';

const mail = vi.mocked(sendMail);
// Than khoi { }: ham TRA VE tu beforeEach bi vitest coi la ham don dep (mockClear tra ve chinh mock)
beforeEach(() => {
  mail.mockClear();
  rt.emitToBoard.mockClear();
  rt.emitToUser.mockClear();
});

const DAY = 86_400_000;
const NOW = new Date();

/** Bo cham diem co dinh (dieu khien diem tung lan quet) - dac trung van tinh that tu CSDL. */
function fixed(scoreRef: { score: number; reasons?: RiskReason[] }, version = 'test'): RiskScorer {
  return {
    version,
    priors: { lateRate: 0.3, daysPerPoint: 2 },
    assess: () => ({
      probability: scoreRef.score / 100,
      score: scoreRef.score,
      level: levelOf(scoreRef.score),
      reasons: scoreRef.reasons ?? [{ code: 'ASSIGNEE_LATE_HISTORY', params: { lateCount: 6, outcomeCount: 10 } }, { code: 'LITTLE_TIME', params: { daysLeft: 2 } }],
      modelVersion: version,
    }),
  };
}

interface World {
  owner: TestUser;
  assignee: TestUser;
  member: TestUser;
  watcher: TestUser;
  outsider: TestUser;
  boardId: string;
  cardId: string;
}

async function world(dueInDays = 3): Promise<World> {
  // makeDirectUser: tep can > 10 tai khoan, ma registerLimiter chi cho 10 lan dang ky / gio / tep
  const owner = await makeDirectUser('Chủ bảng');
  const assignee = await makeDirectUser('Người được giao');
  const member = await makeDirectUser('Thành viên khác');
  const watcher = await makeDirectUser('Người theo dõi');
  const outsider = await makeDirectUser('Người ngoài');
  const board = await makeBoard(owner);
  for (const u of [assignee, member, watcher]) await addMember(owner, board.id, u.email);
  const list = await makeList(owner, board.id);
  const card = await makeCard(owner, list.id, 'Làm slide thuyết trình');
  await agent().patch(`/api/cards/${card.id}`).set('Cookie', owner.cookie).send({ dueDate: new Date(NOW.getTime() + dueInDays * DAY).toISOString() }).expect(200);
  await prisma.cardMember.create({ data: { cardId: card.id, userId: assignee.id } });
  await agent().put(`/api/cards/${card.id}/watch`).set('Cookie', watcher.cookie).send({ watching: true }).expect(200);
  await prisma.notification.deleteMany();
  return { owner, assignee, member, watcher, outsider, boardId: board.id, cardId: card.id };
}

/** Bo che do "lan quet dau" cua bo cham 'test' (nhat ky da co dong mang phien ban do) de thu luat bao. */
const notFirstScan = () => prisma.cardRiskEvent.create({ data: { toLevel: 'SAFE', score: 0, dueDate: NOW, recipients: 0, modelVersion: 'test' } });
const riskNotes = (userId?: string) => prisma.notification.findMany({ where: { type: 'card.risk.warning', ...(userId ? { userId } : {}) } });
// Moc quet tinh LUC GOI (sau khi the da duoc tao) - neu tinh tu NOW (luc nap tep) thi luc do the chua ton tai
const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe('vòng quét: lưu kết quả và luật báo', () => {
  it('lần quét đầu tiên: ghi CardRisk + nhật ký, KHÔNG thông báo / email', async () => {
    const w = await world();
    const s = await runRiskScan(at(0), fixed({ score: 80 }));
    expect(s).toMatchObject({ bootstrap: true, scored: 1, notifications: 0 });
    const row = await prisma.cardRisk.findUniqueOrThrow({ where: { cardId: w.cardId } });
    expect(row).toMatchObject({ score: 80, level: 'CRITICAL', notifiedLevel: 'WARNING', modelVersion: 'test' }); // moc "da bao nguy co"
    expect(await prisma.cardRiskEvent.count({ where: { cardId: w.cardId } })).toBe(1);
    expect(await prisma.cardRiskEvent.count({ where: { cardId: null, modelVersion: 'test' } })).toBe(1); // dong moc
    expect(await riskNotes()).toHaveLength(0);
    expect(mail).not.toHaveBeenCalled();
  });

  it('đổi mô hình (§20.5): lượt quét đầu với phiên bản mới chỉ ghi, kể cả thẻ lên mức; lượt sau báo bình thường', async () => {
    const w = await world();
    await notFirstScan();
    const ref = { score: 30 };
    expect((await runRiskScan(at(0), fixed(ref))).bootstrap).toBe(false);
    ref.score = 62;
    expect(await runRiskScan(at(30), fixed(ref, 'test-v2'))).toMatchObject({ bootstrap: true, notifications: 0 });
    expect(await riskNotes()).toHaveLength(0);
    expect(mail).not.toHaveBeenCalled();
    const row = await prisma.cardRisk.findUniqueOrThrow({ where: { cardId: w.cardId } });
    expect(row).toMatchObject({ level: 'WARNING', notifiedLevel: 'WARNING', modelVersion: 'test-v2' });
    expect(await prisma.cardRiskEvent.count({ where: { cardId: null, modelVersion: 'test-v2' } })).toBe(1);
    ref.score = 70; // moc da ghi luc im lang -> khong bao bu
    expect((await runRiskScan(at(60), fixed(ref, 'test-v2'))).notifications).toBe(0);
    ref.score = 30; // <= 40 -> dat lai
    expect((await runRiskScan(at(90), fixed(ref, 'test-v2'))).notifications).toBe(0);
    ref.score = 62;
    expect(await runRiskScan(at(120), fixed(ref, 'test-v2'))).toMatchObject({ bootstrap: false, notifications: 3 });
    expect(await prisma.cardRiskEvent.count({ where: { cardId: null } })).toBe(2); // moc 'test' + moc 'test-v2', khong them moi luot
  });

  it('lượt im lặng không thẻ nào đổi mức vẫn ghi dòng mốc → lượt sau không còn im lặng', async () => {
    const w = await world();
    await notFirstScan();
    const ref = { score: 30 };
    expect((await runRiskScan(at(0), fixed(ref))).notifications).toBe(0);
    expect((await runRiskScan(at(30), fixed(ref, 'test-v2'))).bootstrap).toBe(true);
    expect(await prisma.cardRiskEvent.count({ where: { cardId: w.cardId, modelVersion: 'test-v2' } })).toBe(0);
    ref.score = 62;
    expect((await runRiskScan(at(60), fixed(ref, 'test-v2'))).notifications).toBe(3);
  });

  it('có nguy cơ: báo người được giao, chủ bảng, người theo dõi — không báo thành viên khác / người ngoài; email không lý do, không mức', async () => {
    const w = await world();
    await notFirstScan();
    const s = await runRiskScan(at(0), fixed({ score: 62 }));
    expect(s.notifications).toBe(3);
    const to = (await riskNotes()).map((n) => n.userId).sort();
    expect(to).toEqual([w.assignee.id, w.owner.id, w.watcher.id].sort());
    const n = (await riskNotes(w.assignee.id))[0]!;
    expect(n.actorId).toBe(w.assignee.id);
    expect(n.data).toMatchObject({ cardTitle: 'Làm slide thuyết trình', kind: 'risk', level: 'WARNING', score: 62 });
    expect(mail).toHaveBeenCalledTimes(3);
    for (const [arg] of mail.mock.calls) {
      expect(arg.subject).toBe('Có nguy cơ trễ hạn: "Làm slide thuyết trình"');
      expect(arg.html).not.toMatch(/Cảnh báo|Nguy cấp/); // khong noi muc (30/10)
      expect(arg.html).not.toContain('6/10');
      expect(arg.html).not.toContain('62%'); // khong dua phan tram ra (28/10)
      expect(arg.html).toContain('có nguy cơ trễ hạn');
      expect(arg.html).toContain(`/boards/${w.boardId}?card=${w.cardId}`);
    }
    expect(await prisma.cardRiskEvent.count({ where: { cardId: w.cardId } })).toBe(1);
  });

  it('đã báo "có nguy cơ": lên Nguy cấp không báo thêm; vừa quá hạn → báo "đã trễ hạn" đúng một lần', async () => {
    const w = await world(); // han sau 3 ngay
    await notFirstScan();
    const ref = { score: 60 };
    expect((await runRiskScan(at(0), fixed(ref))).notifications).toBe(3);
    ref.score = 70;
    expect((await runRiskScan(at(30), fixed(ref))).notifications).toBe(0);
    ref.score = 85; // len Nguy cap - cung mot cau "co nguy co" nen khong bao lai
    expect((await runRiskScan(at(60), fixed(ref))).notifications).toBe(0);
    ref.score = 100;
    const late = at(3 * 24 * 60 + 60); // qua han hon 1 gio, chua toi 24 gio
    expect((await runRiskScan(late, fixed(ref))).notifications).toBe(3);
    expect((await runRiskScan(new Date(late.getTime() + 30 * 60_000), fixed(ref))).notifications).toBe(0);
    const notes = await prisma.notification.findMany({ where: { type: 'card.risk.warning', userId: w.assignee.id }, orderBy: { createdAt: 'asc' } });
    expect(notes.map((x) => (x.data as { kind: string }).kind)).toEqual(['risk', 'overdue']);
    const subjects = mail.mock.calls.filter(([a]) => a.to === w.assignee.email).map(([a]) => a.subject);
    expect(subjects).toEqual(['Có nguy cơ trễ hạn: "Làm slide thuyết trình"', 'Đã trễ hạn: "Làm slide thuyết trình"']);
    expect(mail.mock.calls.at(-1)![0].html).toContain('đã trễ hạn');
    const levels = (await prisma.cardRiskEvent.findMany({ where: { cardId: w.cardId }, orderBy: { createdAt: 'asc' } })).map((e) => e.toLevel);
    expect(levels).toEqual(['WARNING', 'CRITICAL']);
  });

  it('vùng đệm: 45 không đặt lại; ≤ 40 mới đặt lại; đổi hạn cũng đặt lại', async () => {
    const w = await world();
    await notFirstScan();
    const ref = { score: 60 };
    const scan = async (m: number, score: number) => {
      ref.score = score;
      return (await runRiskScan(at(m), fixed(ref))).notifications;
    };
    expect(await scan(0, 60)).toBe(3);
    expect(await scan(30, 45)).toBe(0);
    expect(await scan(60, 60)).toBe(0);
    expect(await scan(90, 38)).toBe(0);
    expect(await scan(120, 60)).toBe(3);
    await agent().patch(`/api/cards/${w.cardId}`).set('Cookie', w.owner.cookie).send({ dueDate: new Date(NOW.getTime() + 5 * DAY).toISOString() }).expect(200);
    expect(await scan(150, 60)).toBe(3);
  });

  it('thẻ quá hạn ≥ 24 giờ: chỉ ghi mức, không gửi', async () => {
    const w = await world(-2);
    await notFirstScan();
    expect((await runRiskScan(at(0), fixed({ score: 100 }))).notifications).toBe(0);
    expect(await prisma.cardRisk.findUnique({ where: { cardId: w.cardId } })).toMatchObject({ level: 'CRITICAL', notifiedLevel: 'CRITICAL' });
  });

  it('ngoài phạm vi quét (hạn xa hơn 14 ngày / không có hạn) → không chấm', async () => {
    await world(20);
    expect((await runRiskScan(at(0), fixed({ score: 90 }))).candidates).toBe(0);
  });

  it('thẻ xong → lần quét sau xoá kết quả; nhật ký vẫn còn', async () => {
    const w = await world();
    await runRiskScan(at(0), fixed({ score: 60 }));
    await agent().patch(`/api/cards/${w.cardId}`).set('Cookie', w.owner.cookie).send({ isDone: true }).expect(200);
    const s = await runRiskScan(at(30), fixed({ score: 60 }));
    expect(s.removed).toBe(1);
    expect(await prisma.cardRisk.count()).toBe(0);
    expect(await prisma.cardRiskEvent.count({ where: { cardId: w.cardId } })).toBe(1);
  });

  it('tuỳ chỉnh: tắt trong app → vẫn lưu nhưng ẩn khỏi chuông; tắt email → không email', async () => {
    const w = await world();
    await notFirstScan();
    await agent().patch('/api/notifications/preferences').set('Cookie', w.assignee.cookie).send({ riskInApp: false, riskEmail: false }).expect(200);
    await runRiskScan(at(0), fixed({ score: 62 }));
    expect(await riskNotes(w.assignee.id)).toHaveLength(1);
    const list = await agent().get('/api/notifications').set('Cookie', w.assignee.cookie).expect(200);
    expect(JSON.stringify(list.body)).not.toContain('card.risk.warning');
    const ownerList = await agent().get('/api/notifications').set('Cookie', w.owner.cookie).expect(200);
    expect(JSON.stringify(ownerList.body)).toContain('card.risk.warning');
    expect(mail.mock.calls.map(([a]) => a.to).sort()).toEqual([w.owner.email, w.watcher.email].sort());
    const pref = await agent().get('/api/notifications/preferences').set('Cookie', w.assignee.cookie).expect(200);
    expect(JSON.stringify(pref.body)).toContain('"riskInApp":false');
  });

  it('giới hạn 20 email cảnh báo / người / 24 giờ (vượt thì chỉ còn trong app)', async () => {
    const w = await world();
    await notFirstScan();
    await prisma.notification.createMany({
      data: Array.from({ length: 20 }, () => ({ userId: w.assignee.id, actorId: w.assignee.id, type: 'card.risk.warning', createdAt: at(-60) })),
    });
    await runRiskScan(at(0), fixed({ score: 62 }));
    expect(mail.mock.calls.map(([a]) => a.to)).not.toContain(w.assignee.email);
    expect(mail).toHaveBeenCalledTimes(2);
  });

  it('giới hạn email đúng biên: đã có 19 trong 24 giờ → lần thứ 20 vẫn gửi', async () => {
    const w = await world();
    await notFirstScan();
    await prisma.notification.createMany({
      data: Array.from({ length: 19 }, () => ({ userId: w.assignee.id, actorId: w.assignee.id, type: 'card.risk.warning', createdAt: at(-60) })),
    });
    await runRiskScan(at(0), fixed({ score: 62 }));
    expect(mail.mock.calls.map(([a]) => a.to)).toContain(w.assignee.email);
  });

  it('realtime: đổi mức → làm mới bảng; báo → chuông của người bật trong app (không phải người đã tắt)', async () => {
    const w = await world();
    await notFirstScan();
    await agent().patch('/api/notifications/preferences').set('Cookie', w.watcher.cookie).send({ riskInApp: false }).expect(200);
    rt.emitToBoard.mockClear();
    rt.emitToUser.mockClear();
    const ref = { score: 62 };
    await runRiskScan(at(0), fixed(ref));
    expect(rt.emitToBoard).toHaveBeenCalledWith(w.boardId, 'board:lists-changed');
    const pinged = rt.emitToUser.mock.calls.filter(([, e]) => e === 'notification:new').map(([id]) => id).sort();
    expect(pinged).toEqual([w.assignee.id, w.owner.id].sort());
    rt.emitToBoard.mockClear();
    ref.score = 70; // cung muc Canh bao -> khong lam moi bang
    await runRiskScan(at(30), fixed(ref));
    expect(rt.emitToBoard).not.toHaveBeenCalled();
  });

  it('gửi mail lỗi không làm hỏng vòng quét', async () => {
    const w = await world();
    await notFirstScan();
    mail.mockRejectedValueOnce(new Error('SMTP sập'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await runRiskScan(at(0), fixed({ score: 62 }));
    errors.mockRestore();
    expect(s.notifications).toBe(3);
    expect(await riskNotes()).toHaveLength(3);
    expect(await prisma.cardRisk.findUnique({ where: { cardId: w.cardId } })).not.toBeNull();
  });

  it('chấm bằng mô hình thật: điểm 0–100, lưu đủ 15 đặc trưng, không lỗi', async () => {
    const w = await world();
    await runRiskScan(at(0));
    const row = await prisma.cardRisk.findUniqueOrThrow({ where: { cardId: w.cardId } });
    expect(Number.isInteger(row.score) && row.score >= 0 && row.score <= 100).toBe(true);
    expect(row.modelVersion).toBe('logreg-v3');
    expect(Object.keys((row.features as { values: object }).values)).toHaveLength(15);
    expect(row.level).toBe(levelOf(row.score));
  });
});

describe('GET /api/cards/:cardId/risk', () => {
  const get = (u: TestUser, cardId: string) => agent().get(`/api/cards/${cardId}/risk`).set('Cookie', u.cookie);

  it('người được giao / chủ bảng thấy số liệu; thành viên khác thấy lý do về người đã che; không bao giờ có features', async () => {
    const w = await world();
    await runRiskScan(at(0), fixed({ score: 62 }));
    for (const u of [w.assignee, w.owner]) {
      const r = (await get(u, w.cardId).expect(200)).body.data.risk;
      expect(r).toMatchObject({ score: 62, level: 'WARNING', modelVersion: 'test' });
      expect(r.reasons[0]).toEqual({ code: 'ASSIGNEE_LATE_HISTORY', params: { lateCount: 6, outcomeCount: 10 } });
      expect(r).not.toHaveProperty('features');
    }
    const masked = (await get(w.member, w.cardId).expect(200)).body.data.risk;
    expect(masked.reasons).toEqual([
      { code: 'ASSIGNEE_LATE_HISTORY', params: {}, masked: true },
      { code: 'LITTLE_TIME', params: { daysLeft: 2 } },
    ]);
    expect(JSON.stringify(masked)).not.toContain('outcomeCount');
  });

  it('người không xem được bảng → bị chặn; chưa đăng nhập → 401', async () => {
    const w = await world();
    await runRiskScan(at(0), fixed({ score: 62 }));
    const res = await get(w.outsider, w.cardId);
    expect([403, 404]).toContain(res.status);
    await agent().get(`/api/cards/${w.cardId}/risk`).expect(401);
  });

  it('kết quả cũ (vừa đổi hạn / vừa xong) → null cho tới lượt quét sau', async () => {
    const w = await world();
    await runRiskScan(at(0), fixed({ score: 62 }));
    await agent().patch(`/api/cards/${w.cardId}`).set('Cookie', w.owner.cookie).send({ dueDate: new Date(NOW.getTime() + 4 * DAY).toISOString() }).expect(200);
    expect((await get(w.owner, w.cardId).expect(200)).body.data.risk).toBeNull();
    await runRiskScan(at(30), fixed({ score: 62 }));
    expect((await get(w.owner, w.cardId).expect(200)).body.data.risk).not.toBeNull();
    await agent().patch(`/api/cards/${w.cardId}`).set('Cookie', w.owner.cookie).send({ isDone: true }).expect(200);
    expect((await get(w.owner, w.cardId).expect(200)).body.data.risk).toBeNull();
  });

  it('cột hoặc bảng chứa thẻ bị lưu trữ → 404 (kết quả cũ không lộ ra dù vòng quét chưa xoá)', async () => {
    const w = await world();
    await runRiskScan(at(0), fixed({ score: 62 }));
    const card = await prisma.card.findUniqueOrThrow({ where: { id: w.cardId }, select: { listId: true } });
    await prisma.list.update({ where: { id: card.listId }, data: { archivedAt: new Date() } });
    expect((await get(w.owner, w.cardId)).status).toBe(404);
    await prisma.list.update({ where: { id: card.listId }, data: { archivedAt: null } });
    await prisma.board.update({ where: { id: w.boardId }, data: { archivedAt: new Date() } });
    expect((await get(w.owner, w.cardId)).status).toBe(404);
  });

  it('chưa từng chấm → null', async () => {
    const w = await world();
    expect((await get(w.owner, w.cardId).expect(200)).body.data.risk).toBeNull();
  });
});

describe('dữ liệu cột của bảng: dấu trên thẻ', () => {
  const lists = (u: TestUser, boardId: string) => agent().get(`/api/boards/${boardId}/lists`).set('Cookie', u.cookie);
  const cardOf = (body: { data: { lists: { cards: { id: string; risk: unknown }[] }[] } }, id: string) =>
    body.data.lists.flatMap((l) => l.cards).find((c) => c.id === id)!;

  it('thành viên thấy { score, level }; người ngoài xem bảng PUBLIC không thấy', async () => {
    const w = await world();
    await runRiskScan(at(0), fixed({ score: 62 }));
    const mine = cardOf((await lists(w.member, w.boardId).expect(200)).body, w.cardId);
    expect(mine.risk).toEqual({ score: 62, level: 'WARNING' });
    await prisma.board.update({ where: { id: w.boardId }, data: { visibility: 'PUBLIC' } });
    const pub = cardOf((await lists(w.outsider, w.boardId).expect(200)).body, w.cardId);
    expect(pub.risk).toBeNull();
  });

  it('kết quả cũ không hiện trên thẻ', async () => {
    const w = await world();
    await runRiskScan(at(0), fixed({ score: 62 }));
    await agent().patch(`/api/cards/${w.cardId}`).set('Cookie', w.owner.cookie).send({ dueDate: new Date(NOW.getTime() + 6 * DAY).toISOString() }).expect(200);
    expect(cardOf((await lists(w.owner, w.boardId).expect(200)).body, w.cardId).risk).toBeNull();
  });
});
