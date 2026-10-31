import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { runOnce } from '../src/modules/card/recurringSchedule.service';
import * as listService from '../src/modules/list/list.service';
import { agent, makeBoard, makeList, makeUser } from './helpers';

async function makeDailySchedule(
  owner: Awaited<ReturnType<typeof makeUser>>,
  listId: string,
  overrides: Record<string, unknown> = {}
) {
  const res = await agent()
    .post(`/api/lists/${listId}/recurring-schedules`)
    .set('Cookie', owner.cookie)
    .send({
      title: 'Bao cao tuan',
      frequency: 'DAILY',
      timeOfDay: '09:00',
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data.schedule as { id: string };
}

// [P2] Scheduler doc duoc lich dang hoat dong, nhung nguoi dung tam dung/sua
// lich NGAY SAU do (truoc khi scheduler kip claim) - claim phai phat hien
// duoc thay doi nay (qua isPaused + updatedAt lam "phien ban"), khong duoc
// dung du lieu cu (da doc tu truoc) de tao the.
describe('recurringSchedule.service.runOnce - claim phai phat hien thay doi giua luc xu ly', () => {
  it('lich bi TAM DUNG ngay sau khi scheduler doc (truoc khi claim) -> khong tao the', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const schedule = await makeDailySchedule(owner, list.id, {
      title: 'The khong duoc tao vi da tam dung',
    });
    await prisma.recurringCardSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });

    // assertListAccess la buoc dau tien runOnce() goi SAU khi doc candidates
    // va TRUOC khi claim - chen hanh dong "nguoi dung tam dung lich" vao
    // dung khe ho nay (dung API that, giong nguoi dung that bam nut).
    const realAssertListAccess = listService.assertListAccess;
    const spy = vi
      .spyOn(listService, 'assertListAccess')
      .mockImplementationOnce(async (...args) => {
        await agent()
          .patch(`/api/recurring-schedules/${schedule.id}`)
          .set('Cookie', owner.cookie)
          .send({ isPaused: true })
          .expect(200);
        return realAssertListAccess(...args);
      });

    await runOnce();
    spy.mockRestore();

    const cards = await prisma.card.findMany({ where: { listId: list.id } });
    expect(cards).toHaveLength(0);

    const row = await prisma.recurringCardSchedule.findUnique({
      where: { id: schedule.id },
    });
    expect(row!.isPaused).toBe(true);
    expect(row!.lastRunAt).toBeNull();
  });

  it('tieu de bi SUA ngay sau khi scheduler doc (truoc khi claim) -> lan nay khong tao the (bo qua an toan); lan quet sau tao dung voi tieu de MOI', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const schedule = await makeDailySchedule(owner, list.id, {
      title: 'Tieu de CU',
    });
    await prisma.recurringCardSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });

    const realAssertListAccess = listService.assertListAccess;
    const spy = vi
      .spyOn(listService, 'assertListAccess')
      .mockImplementationOnce(async (...args) => {
        await agent()
          .patch(`/api/recurring-schedules/${schedule.id}`)
          .set('Cookie', owner.cookie)
          .send({ title: 'Tieu de MOI' })
          .expect(200);
        return realAssertListAccess(...args);
      });

    await runOnce();
    spy.mockRestore();

    // Lan nay bo qua - KHONG duoc tao the voi tieu de cu (du lieu da loi thoi)
    let cards = await prisma.card.findMany({ where: { listId: list.id } });
    expect(cards).toHaveLength(0);

    // Lich van con han (chua bi tien nextRunAt) -> vong quet sau se doc lai,
    // lan nay khong bi chen sua giua chung -> tao dung voi tieu de MOI.
    await runOnce();
    cards = await prisma.card.findMany({ where: { listId: list.id } });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.title).toBe('Tieu de MOI');
  });
});

// [P2] Chieu nguoc lai: API sua lich (chi doi noi dung, khong doi quy luat
// lap lai) khong duoc GHI DE nextRunAt ma scheduler vua tien trong luc API
// dang xu ly request.
describe('PATCH /api/recurring-schedules/:id - khong duoc de nextRunAt scheduler vua tien', () => {
  it('sua tieu de trong luc scheduler vua claim + tao the xong -> nextRunAt van la gia tri MOI (tuong lai), khong bi de lai gia tri cu', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const schedule = await makeDailySchedule(owner, list.id, { title: 'Tieu de cu' });
    await prisma.recurringCardSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });

    // updateSchedule() cung goi assertListAccess ngay sau khi doc "schedule"
    // (truoc khi tinh toan va ghi) - dung diem nay de chen "scheduler chay
    // xong tron ven 1 chu ky" vao GIUA luc API da doc (schedule cu) va luc
    // API ghi (van dung du lieu cu do vi khong doc lai).
    const realAssertListAccess = listService.assertListAccess;
    const spy = vi
      .spyOn(listService, 'assertListAccess')
      .mockImplementationOnce(async (...args) => {
        await runOnce();
        return realAssertListAccess(...args);
      });

    const res = await agent()
      .patch(`/api/recurring-schedules/${schedule.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: 'Tieu de moi' });
    spy.mockRestore();
    expect(res.status).toBe(200);

    // Scheduler da claim + tao dung 1 the cho ky vua den han
    const cards = await prisma.card.findMany({ where: { listId: list.id } });
    expect(cards).toHaveLength(1);

    // nextRunAt phai la gia tri MOI (tuong lai) scheduler vua dat - KHONG bi
    // API de lai gia tri cu (da qua han) chi vi request nay chi sua tieu de
    const row = await prisma.recurringCardSchedule.findUnique({
      where: { id: schedule.id },
    });
    expect(row!.title).toBe('Tieu de moi');
    expect(row!.nextRunAt.getTime()).toBeGreaterThan(Date.now());

    // Vong quet tiep theo: chua den han (nextRunAt con o tuong lai) -> KHONG
    // duoc tao them the (neu bug con, nextRunAt se bi de ve qua khu -> tao
    // trung cho ky vua xu ly xong).
    await runOnce();
    const cardsAfter = await prisma.card.findMany({ where: { listId: list.id } });
    expect(cardsAfter).toHaveLength(1);
  });
});
