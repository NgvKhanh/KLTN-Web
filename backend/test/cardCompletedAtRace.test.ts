import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

// CODE_REVIEW.md #13: updateCard() doc `card.isDone` MOT LAN truoc khi cap nhat (qua
// assertCardAccess), roi quyet dinh co ghi completedAt hay khong dua tren snapshot CU
// do. Neu mot giao dich khac vua doi isDone NGAY SAU lan doc do nhung TRUOC khi request
// nay ghi, quyet dinh se sai va lam completedAt lech khoi isDone that su trong DB.
//
// Mo phong bang cach GIU MO mot giao dich khac (FOR UPDATE) cho toi khi PATCH thuc su
// da doc xong snapshot cu cua no - dam bao dung thu tu can kiem, khong phu thuoc may
// rui vao toc do 2 request chay Promise.all.
describe('PATCH /api/cards/:id - khong lech bat bien isDone <-> completedAt khi co giao dich khac xen vao', () => {
  it('giao dich khac vua doi isDone=true (chua tra loi luc PATCH bat dau) -> PATCH isDone=false van xoa dung completedAt', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id); // isDone=false, completedAt=null luc dau

    let releaseLock: () => void = () => {};
    const locked = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    // Giu khoa dong the (FOR UPDATE) va DA ghi isDone=true nhung CHUA commit.
    const otherTx = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Card" WHERE id = ${card.id} FOR UPDATE`;
      // Ghi DU 3 cot trang thai nhu moi duong ghi that (bat bien status = DONE <->
      // isDone <-> completedAt, tu khi co trang thai theo cot).
      await tx.card.update({
        where: { id: card.id },
        data: { status: 'DONE', isDone: true, completedAt: new Date() },
      });
      await locked; // giu giao dich mo toi khi test cho phep commit
    });

    // Luc PATCH nay bat dau, DB van doc duoc isDone=false (giao dich kia chua commit,
    // doc thuong khong bi khoa chan) - dung snapshot "cu" ma loi #13 mo ta.
    // LUU Y: supertest/superagent chi thuc su GUI request luc `.then()`/await dau
    // tien duoc goi (xem RequestBase.prototype.then) - phai `.then()` NGAY o day de
    // ep gui request thuc su truoc doan cho ben duoi, khong phai luc `await` o cuoi.
    const patchPromise = agent()
      .patch(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie)
      .send({ isDone: false })
      .then((r) => r);

    // Khoang cho ngan de chac chan PATCH da doc xong snapshot cu (1 SELECT khong khoa,
    // rat nhanh) truoc khi giao dich kia duoc phep commit.
    await new Promise((r) => setTimeout(r, 50));
    releaseLock();
    await otherTx;
    const res = await patchPromise;
    expect(res.status).toBe(200);

    const row = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    // Gia tri THAT SU ngay truoc khi PATCH ghi la true (tu giao dich kia) -> PATCH
    // isDone:false la mot thay doi THAT (true -> false) nen PHAI xoa completedAt,
    // du snapshot ban dau cua no la false.
    expect(row.isDone).toBe(false);
    expect(row.completedAt).toBeNull();
  });

  it('gui lai DUNG gia tri isDone hien tai (khong doi ten/gi khac) -> KHONG lam troi moc completedAt cu', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);

    const first = await agent()
      .patch(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie)
      .send({ isDone: true });
    const firstCompletedAt = first.body.data.card.completedAt as string;
    expect(firstCompletedAt).toBeTruthy();

    await new Promise((r) => setTimeout(r, 20));
    const second = await agent()
      .patch(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie)
      .send({ isDone: true, title: 'Doi ten, khong dinh gi isDone' });

    expect(second.status).toBe(200);
    expect(second.body.data.card.completedAt).toBe(firstCompletedAt);
  });
});
