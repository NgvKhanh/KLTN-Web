import { describe, expect, it, vi } from 'vitest';
import { sendMail } from '../src/config/mailer';
import { runOnce as runDigestOnce } from '../src/modules/notification/digest.scheduler';
import { addMember, agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

const mailMock = vi.mocked(sendMail);

async function patchPreference(
  actor: Awaited<ReturnType<typeof makeUser>>,
  body: Record<string, boolean>
) {
  const res = await agent()
    .patch('/api/notifications/preferences')
    .set('Cookie', actor.cookie)
    .send(body);
  expect(res.status).toBe(200);
}

// [P3] Tat thong bao "the" trong-app nhung van bat email tong hop cho nhom
// "the" -> email tong hop van phai co noi dung (truoc day bi mat vi notify()
// loc bo nguoi nhan ngay tu buoc LUU, khong con gi de digest doc lai).
describe('Email tong hop van co noi dung du da tat hien thi trong-app cung nhom', () => {
  it('tat cardInApp, bat dailyDigestEnabled + cardEmailDigest -> digest van bao dung so luong', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    await patchPreference(member, {
      cardInApp: false,
      dailyDigestEnabled: true,
      cardEmailDigest: true,
    });

    const board = await makeBoard(owner);
    await addMember(owner, board.id, member.email);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    await agent()
      .post(`/api/cards/${card.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: member.id })
      .expect(201);

    mailMock.mockClear();
    await runDigestOnce();

    expect(mailMock).toHaveBeenCalledTimes(1);
    const call = mailMock.mock.calls[0]![0] as { to: string; html: string };
    expect(call.to).toBe(member.email);
    expect(call.html).toContain('1 thông báo hoạt động trên thẻ');
  });
});
