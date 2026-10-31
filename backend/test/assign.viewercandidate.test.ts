// Ứng viên nhận việc KHÔNG gồm người bị hạ xuống VIEWER riêng ở bảng, dù họ là thành viên không gian của bảng mức WORKSPACE
// (quyền ở bảng thắng quyền ở không gian - giống isBoardParticipant và nút giao của giao diện). Trước đây module gợi ý họ rồi nút "giao" bị chặn (400).
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { isBoardParticipant } from '../src/modules/board/board.service';
import { planForList, suggestForCard } from '../src/modules/assign/assign.service';
import { daysAgo, giveHistory, mkCard, newTarget, world } from './assignFixtures';

describe('readCandidates: loại người chỉ-xem ở bảng dù là thành viên không gian', () => {
  async function setup() {
    const w = await world('WORKSPACE');
    // viewer + wsMember là thành viên không gian; viewer bị hạ xuống VIEWER riêng ở bảng (world() đã tạo dòng VIEWER)
    await prisma.workspaceMember.createMany({ data: [{ workspaceId: w.wsId, userId: w.viewer.id, role: 'MEMBER' }] });
    return w;
  }

  it('gợi ý một thẻ: không có người chỉ-xem trong danh sách ứng viên (kể cả khi họ có lịch sử giống nhất)', async () => {
    const w = await setup();
    await giveHistory(w.listId, w.viewer.id);
    const target = await newTarget(w.listId);
    expect(await isBoardParticipant(w.boardId, w.viewer.id)).toBe(false);
    const result = await suggestForCard(w.owner.id, target.id, new Date());
    const ids = result.candidates.map((c) => c.user.id);
    expect(ids).not.toContain(w.viewer.id);
    expect(ids).toEqual(expect.arrayContaining([w.owner.id, w.alice.id, w.bob.id]));
  });

  it('chia việc cho cả cột: không dòng nào giao cho người chỉ-xem; người chỉ-xem không có trong danh sách người nhận', async () => {
    const w = await setup();
    for (let i = 0; i < 6; i += 1) await mkCard(w.listId, { title: `Viec cho nhom so ${i}`, dueDate: new Date(Date.now() + (i + 1) * 86_400_000), createdAt: daysAgo(1) });
    const plan = await planForList(w.owner.id, w.listId, new Date());
    expect(plan.people.map((p) => p.user.id)).not.toContain(w.viewer.id);
    expect(plan.rows.length).toBe(6);
    expect(plan.rows.every((r) => r.assignee !== null && r.assignee.user.id !== w.viewer.id)).toBe(true);
  });

  it('chủ bảng luôn là ứng viên; thành viên không gian KHÔNG có dòng ở bảng vẫn là ứng viên (bảng mức WORKSPACE)', async () => {
    const w = await setup();
    const target = await newTarget(w.listId);
    const result = await suggestForCard(w.owner.id, target.id, new Date());
    expect(result.candidates.map((c) => c.user.id)).toContain(w.owner.id);
    const wsMember = await prisma.user.findFirstOrThrow({ where: { id: w.outsider.id } });
    await prisma.workspaceMember.create({ data: { workspaceId: w.wsId, userId: wsMember.id, role: 'MEMBER' } });
    expect((await suggestForCard(w.owner.id, target.id, new Date())).candidates.map((c) => c.user.id)).toContain(wsMember.id);
  });

  it('chủ bảng vẫn là ứng viên dù còn sót một dòng VIEWER ở bảng (ví dụ sau khi chuyển quyền sở hữu)', async () => {
    const w = await setup();
    await prisma.boardMember.upsert({ where: { boardId_userId: { boardId: w.boardId, userId: w.owner.id } }, update: { role: 'VIEWER' }, create: { boardId: w.boardId, userId: w.owner.id, role: 'VIEWER' } });
    expect(await isBoardParticipant(w.boardId, w.owner.id)).toBe(true);
    const target = await newTarget(w.listId);
    const ids = (await suggestForCard(w.alice.id, target.id, new Date())).candidates.map((c) => c.user.id);
    expect(ids).toContain(w.owner.id);
  });

  it('bảng PRIVATE: hành vi cũ không đổi (người chỉ-xem vốn không phải ứng viên)', async () => {
    const w = await world('PRIVATE');
    const target = await newTarget(w.listId);
    const ids = (await suggestForCard(w.owner.id, target.id, new Date())).candidates.map((c) => c.user.id);
    expect(ids).not.toContain(w.viewer.id);
    expect(ids).toEqual(expect.arrayContaining([w.owner.id, w.alice.id, w.bob.id]));
  });
});
