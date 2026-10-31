import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { findCardConflicts } from '../src/modules/card/card.service';
import {
  addMember,
  agent,
  makeBoard,
  makeCard,
  makeDirectUser,
  makeList,
} from './helpers';

const patch = (cookie: string, cardId: string, body: unknown) =>
  agent().patch(`/api/cards/${cardId}`).set('Cookie', cookie).send(body as object);

// 2 nguoi cung mo 1 the: A va B, ca hai deu doc duoc/sua duoc.
async function setup() {
  // makeDirectUser: file nay can nhieu tai khoan hon gioi han 10 lan dang ky / gio
  const a = await makeDirectUser("Nguoi A");
  const b = await makeDirectUser("Nguoi B");
  const board = await makeBoard(a);
  await addMember(a, board.id, b.email, 'MEMBER');
  const list = await makeList(a, board.id);
  const card = await makeCard(a, list.id, 'Tieu de goc');
  return { a, b, board, list, card };
}

describe('findCardConflicts (ham thuan)', () => {
  const cur = {
    title: 'B da doi',
    description: 'mo ta B',
    startDate: null,
    dueDate: new Date('2026-10-20T10:00:00.000Z'),
  };

  it('gia tri hien tai khac goc va khac gia tri moi -> xung dot', () => {
    expect(
      findCardConflicts(cur, { title: 'A doi' }, { title: 'Tieu de goc' })
    ).toEqual({ title: 'B da doi' });
  });

  it('gia tri hien tai == goc -> khong xung dot', () => {
    expect(
      findCardConflicts(cur, { title: 'A doi' }, { title: 'B da doi' })
    ).toBeNull();
  });

  it('gia tri hien tai == gia tri sap ghi (hai nguoi cung ra mot ket qua) -> khong xung dot', () => {
    expect(
      findCardConflicts(cur, { title: 'B da doi' }, { title: 'Tieu de goc' })
    ).toBeNull();
  });

  it('truong khong duoc sua thi khong bao gio xung dot', () => {
    expect(
      findCardConflicts(cur, { dueDate: undefined }, { title: 'x', description: 'y' })
    ).toBeNull();
  });

  it('so ngay theo thoi diem, khong theo chuoi', () => {
    expect(
      findCardConflicts(
        cur,
        { dueDate: '2026-10-25T00:00:00.000Z' },
        { dueDate: '2026-10-20T10:00:00Z' }
      )
    ).toBeNull();
    expect(
      findCardConflicts(
        cur,
        { dueDate: '2026-10-25T00:00:00.000Z' },
        { dueDate: null }
      )
    ).toEqual({ dueDate: '2026-10-20T10:00:00.000Z' });
  });
});

describe('PATCH /api/cards/:id - khoa lac quan theo truong (expected)', () => {
  it('gia tri goc con dung -> ghi binh thuong', async () => {
    const { a, card } = await setup();
    const res = await patch(a.cookie, card.id, {
      title: 'A doi',
      expected: { title: 'Tieu de goc' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.card.title).toBe('A doi');
  });

  it('nguoi khac da doi tieu de -> 409 CARD_CONFLICT kem gia tri hien tai, KHONG ghi de', async () => {
    const { a, b, card } = await setup();
    // B luu truoc
    const first = await patch(b.cookie, card.id, {
      title: 'B doi truoc',
      expected: { title: 'Tieu de goc' },
    });
    expect(first.status).toBe(200);

    // A van dua tren gia tri goc -> bi chan
    const res = await patch(a.cookie, card.id, {
      title: 'A doi sau',
      expected: { title: 'Tieu de goc' },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CARD_CONFLICT');
    expect(res.body.data.fields).toEqual(['title']);
    expect(res.body.data.current).toEqual({ title: 'B doi truoc' });

    const row = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(row.title).toBe('B doi truoc');
  });

  it('409 khong de lai hieu ung phu: khong co nhat ky "doi ten" cua nguoi bi chan', async () => {
    const { a, b, card } = await setup();
    await patch(b.cookie, card.id, { title: 'B', expected: { title: 'Tieu de goc' } });
    const before = await prisma.activity.count({ where: { cardId: card.id } });
    const res = await patch(a.cookie, card.id, {
      title: 'A',
      expected: { title: 'Tieu de goc' },
    });
    expect(res.status).toBe(409);
    expect(await prisma.activity.count({ where: { cardId: card.id } })).toBe(before);
  });

  it('sau 409, gui lai voi gia tri hien tai lam goc -> ghi duoc (nut "giu ban cua toi")', async () => {
    const { a, b, card } = await setup();
    await patch(b.cookie, card.id, { title: 'B', expected: { title: 'Tieu de goc' } });
    const res = await patch(a.cookie, card.id, {
      title: 'A ghi de co chu y',
      expected: { title: 'B' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.card.title).toBe('A ghi de co chu y');
  });

  it('hai nguoi sua HAI TRUONG KHAC NHAU -> khong xung dot, ca hai deu duoc ghi', async () => {
    const { a, b, card } = await setup();
    const r1 = await patch(a.cookie, card.id, {
      title: 'A doi tieu de',
      expected: { title: 'Tieu de goc' },
    });
    const r2 = await patch(b.cookie, card.id, {
      description: 'B viet mo ta',
      expected: { description: null },
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const row = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(row.title).toBe('A doi tieu de');
    expect(row.description).toBe('B viet mo ta');
  });

  it('xung dot o mo ta (truong khong ghi nhat ky van duoc bao ve)', async () => {
    const { a, b, card } = await setup();
    await patch(b.cookie, card.id, { description: 'Ban cua B', expected: { description: null } });
    const res = await patch(a.cookie, card.id, {
      description: 'Ban cua A',
      expected: { description: null },
    });
    expect(res.status).toBe(409);
    expect(res.body.data.current).toEqual({ description: 'Ban cua B' });
  });

  it('xung dot o han chot: so theo thoi diem', async () => {
    const { a, b, card } = await setup();
    await patch(b.cookie, card.id, {
      dueDate: '2026-11-01T09:00:00.000Z',
      expected: { dueDate: null },
    });
    const res = await patch(a.cookie, card.id, {
      dueDate: '2026-11-05T09:00:00.000Z',
      expected: { dueDate: null },
    });
    expect(res.status).toBe(409);
    expect(res.body.data.current).toEqual({ dueDate: '2026-11-01T09:00:00.000Z' });
  });

  it('hai nguoi cung dua ra DUNG MOT gia tri -> khong tinh la xung dot', async () => {
    const { a, b, card } = await setup();
    await patch(b.cookie, card.id, { title: 'Cung ten', expected: { title: 'Tieu de goc' } });
    const res = await patch(a.cookie, card.id, {
      title: 'Cung ten',
      expected: { title: 'Tieu de goc' },
    });
    expect(res.status).toBe(200);
  });

  it('khong gui expected -> hanh vi cu (nguoi sau ghi de), khong vo cac noi goi cu', async () => {
    const { a, b, card } = await setup();
    await patch(b.cookie, card.id, { title: 'B' });
    const res = await patch(a.cookie, card.id, { title: 'A' });
    expect(res.status).toBe(200);
    expect(res.body.data.card.title).toBe('A');
  });

  it('body chi co expected (khong co gi de cap nhat) -> 400', async () => {
    const { a, card } = await setup();
    const res = await patch(a.cookie, card.id, { expected: { title: 'Tieu de goc' } });
    expect(res.status).toBe(400);
  });

  it('keo tha the KHAC trong cung cot (ghi lai position) khong gay xung dot gia cho the dang sua', async () => {
    const { a, b, list, card } = await setup();
    const other = await makeCard(a, list.id, 'The ben canh');
    // B keo the ben canh len dau cot -> position cua ca cot bi danh lai
    const mv = await agent()
      .patch(`/api/cards/${other.id}/move`)
      .set('Cookie', b.cookie)
      .send({ listId: list.id, position: 0 });
    expect(mv.status).toBe(200);

    const res = await patch(a.cookie, card.id, {
      title: 'A van luu duoc',
      expected: { title: 'Tieu de goc' },
    });
    expect(res.status).toBe(200);
  });

  it('2 request cung luc dua tren cung gia tri goc -> dung 1 cai thanh cong, 1 cai 409', async () => {
    const { a, b, card } = await setup();
    const send = (u: typeof a, title: string) =>
      patch(u.cookie, card.id, { title, expected: { title: 'Tieu de goc' } }).then(
        (r) => r
      );
    const results = await Promise.all([send(a, 'Tu A'), send(b, 'Tu B')]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);

    const winner = results.find((r) => r.status === 200)!;
    const row = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(row.title).toBe(winner.body.data.card.title);
  });
});

describe('PATCH /api/cards/:id/move - keo tha dong thoi', () => {
  it('2 the tu 2 nguoi cung keo vao 1 cot cung luc -> vi tri khong trung, khong mat the', async () => {
    const { a, b, board } = await setup();
    const target = await makeList(a, board.id, 'Dich');
    const t1 = await makeCard(a, target.id, 'D1');
    const t2 = await makeCard(a, target.id, 'D2');

    const src = await makeList(a, board.id, 'Nguon');
    const m1 = await makeCard(a, src.id, 'M1');
    const m2 = await makeCard(a, src.id, 'M2');
    const m3 = await makeCard(a, src.id, 'M3');

    const mv = (u: typeof a, id: string, position: number) =>
      agent()
        .patch(`/api/cards/${id}/move`)
        .set('Cookie', u.cookie)
        .send({ listId: target.id, position })
        .then((r) => r);
    const rs = await Promise.all([mv(a, m1.id, 0), mv(b, m2.id, 0), mv(a, m3.id, 1)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);

    const inTarget = await prisma.card.findMany({
      where: { listId: target.id, deletedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    // 2 the san co + 3 the vua keo, vi tri la hoan vi lien tuc 0..4
    expect(inTarget).toHaveLength(5);
    expect(inTarget.map((c) => c.position)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(inTarget.map((c) => c.id))).toEqual(
      new Set([t1.id, t2.id, m1.id, m2.id, m3.id])
    );

    // Cot nguon rong, khong sot the nao
    expect(
      await prisma.card.count({ where: { listId: src.id, deletedAt: null } })
    ).toBe(0);
  });

  it('keo giua cac cot: cot nguon duoc danh lai vi tri lien tuc', async () => {
    const { a, board } = await setup();
    const src = await makeList(a, board.id, 'Nguon');
    const c1 = await makeCard(a, src.id, 'C1');
    const c2 = await makeCard(a, src.id, 'C2');
    const c3 = await makeCard(a, src.id, 'C3');
    const dst = await makeList(a, board.id, 'Dich');

    const res = await agent()
      .patch(`/api/cards/${c2.id}/move`)
      .set('Cookie', a.cookie)
      .send({ listId: dst.id, position: 0 });
    expect(res.status).toBe(200);

    const left = await prisma.card.findMany({
      where: { listId: src.id },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    expect(left).toEqual([
      { id: c1.id, position: 0 },
      { id: c3.id, position: 1 },
    ]);
  });
});
