// Thế giới dữ liệu cho test công cụ `query_data` (chatbot v2, bước B). Mở rộng seedActions bằng mô tả, bình luận, checklist, tệp đính kèm.
//
// Quy ước: mọi bản ghi "bẫy" (thẻ đã lưu trữ / đã xóa, bình luận đã xóa, dữ liệu ở bảng bí mật) có tiêu đề hoặc nội dung chứa chữ BẪY để test
// chứng minh chúng KHÔNG bao giờ xuất hiện trong kết quả.
import { prisma } from '../src/config/prisma';
import { seedActions, type ActionWorld } from './chat.actions.fixture';

export const D = (iso: string) => new Date(iso);
export async function seedData() {
  const f = await seedActions();
  // mô tả + người phụ trách + nhãn
  await prisma.card.update({ where: { id: f.design.id }, data: { description: 'Cần thiết kế màn hình thanh toán và đăng nhập', startDate: D('2026-10-01T02:00:00.000Z'), dueDate: D('2026-10-08T10:00:00.000Z') } });
  await prisma.card.update({ where: { id: f.payment.id }, data: { description: 'Tích hợp cổng thanh toán VNPay', dueDate: D('2026-10-15T10:00:00.000Z') } });
  await prisma.card.update({ where: { id: f.loginApi.id }, data: { status: 'BLOCKED' } });
  await prisma.cardMember.createMany({ data: [
    { cardId: f.design.id, userId: f.lan.id }, { cardId: f.payment.id, userId: f.tuan.id },
    { cardId: f.payment.id, userId: f.lan.id }, { cardId: f.loginApi.id, userId: f.tuan.id },
  ] });
  await prisma.cardLabel.createMany({ data: [{ cardId: f.payment.id, labelId: f.backend.id }, { cardId: f.loginApi.id, labelId: f.backend.id }, { cardId: f.design.id, labelId: f.urgent.id }] });
  // thẻ bẫy: đã lưu trữ / đã xóa (cùng bảng Alpha) - có bình luận, tệp
  const archived = await prisma.card.create({ data: { listId: f.todo.id, title: 'Thẻ BẪY đã lưu trữ', description: 'BẪY mô tả', archivedAt: D('2026-10-02T00:00:00.000Z') } });
  const deleted = await prisma.card.create({ data: { listId: f.todo.id, title: 'Thẻ BẪY đã xóa', deletedAt: D('2026-10-02T00:00:00.000Z') } });
  // bình luận: 1 trả lời, 1 đã xóa, 1 ở bảng Beta, 1 ở bảng bí mật, 1 ở thẻ lưu trữ
  const root = await prisma.comment.create({ data: { cardId: f.design.id, userId: f.lan.id, text: 'Đã xong bản nháp, xem lại giúp mình', createdAt: D('2026-10-05T18:00:00.000Z') } });
  await prisma.comment.create({ data: { cardId: f.design.id, userId: f.tuan.id, parentId: root.id, text: 'Màu chủ đạo cần đổi', createdAt: D('2026-10-06T03:00:00.000Z') } });
  await prisma.comment.create({ data: { cardId: f.payment.id, userId: f.tuan.id, text: 'Lỗi thanh toán khi thẻ hết hạn', createdAt: D('2026-10-07T01:00:00.000Z') } });
  await prisma.comment.create({ data: { cardId: f.payment.id, userId: f.tuan.id, text: 'Đã sửa xong lỗi thanh toán', createdAt: D('2026-10-07T02:00:00.000Z') } });
  await prisma.comment.create({ data: { cardId: f.design.id, userId: f.lan.id, text: 'Bình luận BẪY đã xóa', deletedAt: D('2026-10-06T00:00:00.000Z') } });
  await prisma.comment.create({ data: { cardId: f.loginBeta.id, userId: f.lan.id, text: 'Chỉ bảng Beta mới thấy', createdAt: D('2026-10-04T03:00:00.000Z') } });
  await prisma.comment.create({ data: { cardId: f.secretCard.id, userId: f.outsider.id, text: 'BẪY bí mật không được lộ' } });
  await prisma.comment.create({ data: { cardId: archived.id, userId: f.lan.id, text: 'BẪY bình luận của thẻ lưu trữ' } });
  // checklist
  const cl = await prisma.checklist.create({ data: { cardId: f.design.id, title: 'Việc cần làm' } });
  await prisma.checklistItem.createMany({ data: [
    { checklistId: cl.id, content: 'Vẽ wireframe', isDone: true, assigneeId: f.lan.id },
    { checklistId: cl.id, content: 'Chọn bảng màu', isDone: false, assigneeId: f.lan.id, dueDate: D('2026-10-09T10:00:00.000Z') },
    { checklistId: cl.id, content: 'Xuất tài nguyên', isDone: false },
  ] });
  const secretCl = await prisma.checklist.create({ data: { cardId: f.secretCard.id, title: 'BẪY' } });
  await prisma.checklistItem.create({ data: { checklistId: secretCl.id, content: 'BẪY mục bí mật' } });
  // tệp đính kèm (đường dẫn KHÔNG bao giờ được trả ra)
  await prisma.attachment.createMany({ data: [
    { cardId: f.payment.id, uploaderId: f.tuan.id, name: 'hop-dong.pdf', url: '/uploads/cards/SECRET-PATH-1.pdf', mime: 'application/pdf', size: 120000, createdAt: D('2026-10-03T01:00:00.000Z') },
    { cardId: f.design.id, uploaderId: f.lan.id, name: 'mockup.png', url: '/uploads/cards/SECRET-PATH-2.png', mime: 'image/png', size: 5000, createdAt: D('2026-10-04T01:00:00.000Z') },
    { cardId: f.secretCard.id, uploaderId: f.outsider.id, name: 'BẪY-bi-mat.pdf', url: '/uploads/cards/SECRET-PATH-3.pdf', mime: 'application/pdf', size: 1 },
    { cardId: deleted.id, uploaderId: f.lan.id, name: 'BẪY-the-xoa.pdf', url: '/uploads/cards/SECRET-PATH-4.pdf', mime: 'application/pdf', size: 1 },
  ] });
  return { ...f, archived, deleted, rootComment: root };
}
export type DataWorld = Awaited<ReturnType<typeof seedData>>;
export type { ActionWorld };
