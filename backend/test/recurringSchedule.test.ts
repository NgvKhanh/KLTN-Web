import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
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
  return res.body.data.schedule as { id: string; nextRunAt: string };
}

describe('POST /api/lists/:listId/recurring-schedules', () => {
  it('tao lich DAILY thanh cong, nextRunAt >= hien tai', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);

    const schedule = await makeDailySchedule(owner, list.id);
    expect(new Date(schedule.nextRunAt).getTime()).toBeGreaterThanOrEqual(Date.now());
  });

  it('WEEKLY thieu dayOfWeek -> 400', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);

    const res = await agent()
      .post(`/api/lists/${list.id}/recurring-schedules`)
      .set('Cookie', owner.cookie)
      .send({ title: 'X', frequency: 'WEEKLY', timeOfDay: '09:00' });
    expect(res.status).toBe(400);
  });

  it('MONTHLY thieu dayOfMonth -> 400', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);

    const res = await agent()
      .post(`/api/lists/${list.id}/recurring-schedules`)
      .set('Cookie', owner.cookie)
      .send({ title: 'X', frequency: 'MONTHLY', timeOfDay: '09:00' });
    expect(res.status).toBe(400);
  });

  it('nguoi ngoai bang khong tao duoc -> 403', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);

    const res = await agent()
      .post(`/api/lists/${list.id}/recurring-schedules`)
      .set('Cookie', outsider.cookie)
      .send({ title: 'X', frequency: 'DAILY', timeOfDay: '09:00' });
    expect(res.status).toBe(403);
  });

  it('endDate truoc startDate -> 400', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);

    const res = await agent()
      .post(`/api/lists/${list.id}/recurring-schedules`)
      .set('Cookie', owner.cookie)
      .send({
        title: 'X',
        frequency: 'DAILY',
        timeOfDay: '09:00',
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-05-01T00:00:00.000Z',
      });
    expect(res.status).toBe(400);
  });
});

describe('PATCH/DELETE /api/recurring-schedules/:id', () => {
  it('tam dung, mo lai, roi xoa (cung 1 lich)', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const schedule = await makeDailySchedule(owner, list.id);

    const pause = await agent()
      .patch(`/api/recurring-schedules/${schedule.id}`)
      .set('Cookie', owner.cookie)
      .send({ isPaused: true });
    expect(pause.status).toBe(200);
    expect(pause.body.data.schedule.isPaused).toBe(true);

    const resume = await agent()
      .patch(`/api/recurring-schedules/${schedule.id}`)
      .set('Cookie', owner.cookie)
      .send({ isPaused: false });
    expect(resume.status).toBe(200);
    expect(resume.body.data.schedule.isPaused).toBe(false);

    const del = await agent()
      .delete(`/api/recurring-schedules/${schedule.id}`)
      .set('Cookie', owner.cookie);
    expect(del.status).toBe(200);

    const row = await prisma.recurringCardSchedule.findUnique({
      where: { id: schedule.id },
    });
    expect(row).toBeNull();
  });

  it('nguoi ngoai bang khong sua/xoa duoc -> 403', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const schedule = await makeDailySchedule(owner, list.id);

    const patchRes = await agent()
      .patch(`/api/recurring-schedules/${schedule.id}`)
      .set('Cookie', outsider.cookie)
      .send({ isPaused: true });
    expect(patchRes.status).toBe(403);

    const delRes = await agent()
      .delete(`/api/recurring-schedules/${schedule.id}`)
      .set('Cookie', outsider.cookie);
    expect(delRes.status).toBe(403);
  });
});
