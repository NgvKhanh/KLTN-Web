import { prisma } from '../src/config/prisma';
import { makeDirectUser } from './helpers';

export const V2_NOW = new Date('2026-10-04T08:00:00.000Z');
export const V2_RANGE = { from: '2026-10-01', to: '2026-10-04' };
export async function seedChatV2() {
  const owner = await makeDirectUser('Chủ nhóm');
  const lan = await makeDirectUser('Nguyễn Lan');
  const tuan = await makeDirectUser('Trần Tuấn');
  const zero = await makeDirectUser('Không Việc');
  const outsider = await makeDirectUser('Ngoài nhóm');
  const gone = await makeDirectUser('Đã xóa');
  const ws = await prisma.workspace.create({ data: { name: 'Nhóm kiểm thử', ownerId: owner.id, members: { create: [
    { userId: owner.id, role: 'OWNER' }, ...[lan, tuan, zero].map((u) => ({ userId: u.id, role: 'MEMBER' as const })),
  ] } } });
  const board = await prisma.board.create({ data: { name: '1234', workspaceId: ws.id, ownerId: owner.id, visibility: 'WORKSPACE', lists: { create: { name: 'Cần làm' } } }, include: { lists: true } });
  const numericId = await prisma.board.create({ data: { id: '1234', name: 'Tên khác với mã', workspaceId: ws.id, ownerId: owner.id, visibility: 'PRIVATE' } });
  const secret = await prisma.board.create({ data: { name: 'Riêng tư bí mật', workspaceId: ws.id, ownerId: outsider.id, visibility: 'PRIVATE', lists: { create: { name: 'Cột bí mật' } } }, include: { lists: true } });
  const publicBoard = await prisma.board.create({ data: { name: 'Công khai ngoài nhóm', workspaceId: outsider.personalWorkspaceId, ownerId: outsider.id, visibility: 'PUBLIC', lists: { create: { name: 'Công khai' } } }, include: { lists: true } });
  const columnId = board.lists[0].id;
  const mk = (title: string, assignees: string[] = [], done = false, extra: Record<string, unknown> = {}) => prisma.card.create({ data: {
    listId: columnId, title, dueDate: new Date('2026-10-02T03:00:00.000Z'), createdAt: new Date('2026-10-01T00:00:00.000Z'),
    status: done ? 'DONE' : 'TODO', isDone: done, completedAt: done ? V2_NOW : null,
    members: { create: assignees.map((userId) => ({ userId })) }, ...extra,
  } });
  const a = await mk('Việc của Lan', [lan.id]);
  const shared = await mk('Việc chung', [lan.id, tuan.id]);
  const b = await mk('Việc của Tuấn', [tuan.id]);
  const done = await mk('Đã xong', [tuan.id], true);
  const unassigned = [];
  for (let i = 0; i < 25; i++) unassigned.push(await mk(`Chưa giao ${String(i).padStart(2, '0')}`));
  await prisma.checklist.create({ data: { cardId: unassigned[0].id, title: 'Mục có người', items: { create: { content: 'Việc nhỏ', assigneeId: lan.id } } } });
  const outside = await mk('Giao ngoài roster', [outsider.id]);
  const deletedAssignment = await mk('Tài khoản đã xóa giữ việc', [gone.id]);
  await prisma.user.update({ where: { id: gone.id }, data: { deletedAt: V2_NOW } });
  await mk('Đã lưu trữ', [], false, { archivedAt: V2_NOW });
  await mk('Đã xóa', [], false, { deletedAt: V2_NOW });
  const oldColumn = await prisma.list.create({ data: { boardId: board.id, name: 'Cột lưu trữ', archivedAt: V2_NOW } });
  await prisma.card.create({ data: { listId: oldColumn.id, title: 'Trong cột lưu trữ' } });
  await prisma.card.create({ data: { listId: secret.lists[0].id, title: 'TIÊU ĐỀ BÍ MẬT' } });
  await prisma.card.create({ data: { listId: publicBoard.lists[0].id, title: 'Không thuộc phạm vi chatbot' } });
  const moved = await prisma.card.create({ data: { listId: secret.lists[0].id, title: 'TÊN MỚI RIÊNG TƯ' } });
  const deleted = await mk('Tên thẻ xóa không được hiện', [], false, { deletedAt: V2_NOW });
  for (let i = 0; i < 7; i++) await prisma.activity.create({ data: { boardId: board.id, cardId: a.id, userId: lan.id, type: 'card.rename', createdAt: new Date(`2026-10-02T0${i}:00:00.000Z`), data: { from: `Tên ${i}`, to: `Tên ${i + 1}`, email: 'KHÔNG-ĐƯỢC-LỘ', token: 'KHÔNG-ĐƯỢC-LỘ' } } });
  await prisma.activity.create({ data: { boardId: board.id, cardId: shared.id, userId: lan.id, type: 'card.due.set', createdAt: V2_NOW, data: { dueDate: '2026-10-02T03:00:00.000Z' } } });
  await prisma.activity.create({ data: { boardId: board.id, cardId: unassigned[24].id, userId: tuan.id, type: 'card.status', createdAt: new Date('2026-10-04T16:59:59.999Z'), data: { from: 'IN_PROGRESS', to: 'TODO' } } });
  for (const card of [moved, deleted]) await prisma.activity.create({ data: { boardId: board.id, cardId: card.id, userId: owner.id, type: 'card.rename', createdAt: V2_NOW, data: { from: 'SNAPSHOT BÍ MẬT', to: 'TÊN MỚI RIÊNG TƯ' } } });
  await prisma.activity.create({ data: { boardId: board.id, cardId: b.id, userId: tuan.id, type: 'card.rename', createdAt: new Date('2026-10-04T17:00:00.000Z'), data: { from: 'Ngoài kỳ', to: 'Ngoài kỳ' } } });
  await prisma.activity.create({ data: { boardId: board.id, cardId: done.id, userId: lan.id, type: 'comment.create', createdAt: V2_NOW, data: { text: 'Bình luận không tính thay đổi mặc định' } } });
  return { owner, lan, tuan, zero, outsider, gone, ws, board, numericId, secret, publicBoard, a, shared, b, done, unassigned, outside, deletedAssignment, moved, deleted, columnId };
}
