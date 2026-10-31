import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { runOnce } from '../src/modules/card/recurringSchedule.service';
import * as listService from '../src/modules/list/list.service';
import { addMember, agent, makeBoard, makeList, makeUser } from './helpers';

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
  return res.body.data.schedule as { id: string; nextRunAt: string };
}

describe('recurringSchedule.service.runOnce - vong quet tao the', () => {
  it('den han -> tao 1 the moi trong dung danh sach, tinh lai nextRunAt cho lan sau', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const schedule = await makeDailySchedule(owner, list.id, { title: 'The dinh ky' });

    const pastRun = new Date(Date.now() - 60_000);
    await prisma.recurringCardSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: pastRun },
    });

    await runOnce();

    const cards = await prisma.card.findMany({ where: { listId: list.id } });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.title).toBe('The dinh ky');

    const updated = await prisma.recurringCardSchedule.findUnique({
      where: { id: schedule.id },
    });
    expect(updated!.lastRunAt).not.toBeNull();
    expect(updated!.nextRunAt.getTime()).toBeGreaterThan(pastRun.getTime());
  });

  it('dung mau the (cardTemplateId) -> the moi co mo ta + checklist tu mau', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);

    const tplRes = await agent()
      .post(`/api/boards/${board.id}/card-templates`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Mau bao cao',
        description: 'Mo ta tu mau',
        checklists: [{ title: 'Cong viec', items: ['Buoc 1', 'Buoc 2'] }],
      });
    expect(tplRes.status).toBe(201);
    const templateId = tplRes.body.data.template.id as string;

    const schedule = await makeDailySchedule(owner, list.id, {
      title: 'The tu mau',
      cardTemplateId: templateId,
    });
    await prisma.recurringCardSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });

    await runOnce();

    const card = await prisma.card.findFirst({
      where: { listId: list.id },
      include: { checklists: { include: { items: true } } },
    });
    expect(card?.title).toBe('The tu mau');
    expect(card?.description).toBe('Mo ta tu mau');
    expect(card?.checklists).toHaveLength(1);
    expect(card?.checklists[0]!.items.map((i) => i.content)).toEqual([
      'Buoc 1',
      'Buoc 2',
    ]);
  });

  it('lich dang tam dung -> khong tao the', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const schedule = await makeDailySchedule(owner, list.id);
    await prisma.recurringCardSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: new Date(Date.now() - 60_000), isPaused: true },
    });

    await runOnce();

    const cards = await prisma.card.findMany({ where: { listId: list.id } });
    expect(cards).toHaveLength(0);
  });

  it('da qua ngay dung han -> khong tao the, tu dong tam dung', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const schedule = await makeDailySchedule(owner, list.id);
    // Gia lap thoi gian troi qua: ngay dung han da qua, lan chay ke tiep cung da qua.
    await prisma.recurringCardSchedule.update({
      where: { id: schedule.id },
      data: {
        endDate: new Date(Date.now() - 24 * 60 * 60_000),
        nextRunAt: new Date(Date.now() - 60_000),
      },
    });

    await runOnce();

    const cards = await prisma.card.findMany({ where: { listId: list.id } });
    expect(cards).toHaveLength(0);
    const updated = await prisma.recurringCardSchedule.findUnique({
      where: { id: schedule.id },
    });
    expect(updated!.isPaused).toBe(true);
  });

  it('[P2] hai luot scheduler chay DONG THOI tren cung 1 lich da den han -> chi tao DUNG 1 the (khong trung)', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const schedule = await makeDailySchedule(owner, list.id, { title: 'The khong duoc trung' });
    await prisma.recurringCardSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });

    // Gia lap 2 tien trinh scheduler cung doc duoc lich nay o cung 1 thoi
    // diem (vd 2 instance server khi trien khai nhieu ban sao). De ep 2 loi
    // goi runOnce() THUC SU giao nhau tai doan "da doc candidates, chua kip
    // claim" (khong chi tinh co nho Promise.all), chen 1 do tre nho vao buoc
    // assertListAccess (chay ngay truoc doan claim) cho CA HAI loi goi -
    // dam bao ca 2 cung toi duoc buoc claim gan nhu cung luc.
    const realAssertListAccess = listService.assertListAccess;
    const spy = vi
      .spyOn(listService, 'assertListAccess')
      .mockImplementation(async (...args) => {
        await new Promise((r) => setTimeout(r, 40));
        return realAssertListAccess(...args);
      });

    await Promise.all([runOnce(), runOnce()]);
    spy.mockRestore();

    const cards = await prisma.card.findMany({ where: { listId: list.id } });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.title).toBe('The khong duoc trung');

    const updated = await prisma.recurringCardSchedule.findUnique({
      where: { id: schedule.id },
    });
    // Chi 1 ben "thang" claim -> nextRunAt chi tien dung 1 buoc (1 ngay sau
    // moc cu), khong bi tien nhieu lan boi ca 2 ben.
    expect(updated!.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('[P4] the tao tu lich dinh ky cung duoc chay tu dong hoa "khi tao the" (nhat quan voi tao thu cong)', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);

    const ruleRes = await agent()
      .post(`/api/boards/${board.id}/automation-rules`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'The moi trong list nay -> danh dau xong',
        triggerType: 'CARD_CREATED',
        triggerListId: list.id,
        actions: [{ type: 'SET_DONE', boolValue: true }],
      });
    expect(ruleRes.status).toBe(201);

    const schedule = await makeDailySchedule(owner, list.id, { title: 'The dinh ky co tu dong hoa' });
    await prisma.recurringCardSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });

    await runOnce();

    const card = await prisma.card.findFirst({ where: { listId: list.id } });
    expect(card).toBeTruthy();
    expect(card!.isDone).toBe(true);
  });

  it('nguoi tao lich mat quyen truy cap bang -> tu dong tam dung, khong tao the', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const board = await makeBoard(owner);
    await addMember(owner, board.id, member.email);
    const list = await makeList(owner, board.id);
    const schedule = await makeDailySchedule(member, list.id);

    await agent()
      .delete(`/api/boards/${board.id}/members/${member.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);

    await prisma.recurringCardSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });

    await runOnce();

    const cards = await prisma.card.findMany({ where: { listId: list.id } });
    expect(cards).toHaveLength(0);
    const updated = await prisma.recurringCardSchedule.findUnique({
      where: { id: schedule.id },
    });
    expect(updated!.isPaused).toBe(true);
  });
});
