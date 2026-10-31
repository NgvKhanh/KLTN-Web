import { statusLabel } from './cardStatus';

// Cum tu mo ta 1 dong nhat ky hoat dong (dung chung cho CardModal va bang nhat ky bang)
export function activityPhrase(a: {
  type: string;
  data: Record<string, unknown>;
}): string {
  const d = a.data as Record<string, string>;
  switch (a.type) {
    case 'card.create':
      return `đã thêm thẻ vào danh sách ${d.listName ?? ''}`;
    case 'card.move':
      return d.toBoard
        ? `đã chuyển thẻ từ ${d.fromList} sang bảng "${d.toBoard}" (${d.toList})`
        : `đã chuyển thẻ từ ${d.fromList} sang ${d.toList}`;
    case 'card.rename':
      return 'đã đổi tên thẻ';
    case 'card.done':
      return 'đã đánh dấu thẻ hoàn thành';
    case 'card.undone':
      return 'đã bỏ đánh dấu hoàn thành';
    case 'card.status':
      return `đã chuyển trạng thái thẻ từ "${statusLabel(d.from)}" sang "${statusLabel(d.to)}"`;
    case 'card.due.set':
      return 'đã đặt ngày hết hạn';
    case 'card.due.clear':
      return 'đã bỏ ngày hết hạn';
    case 'card.archive':
      return 'đã lưu trữ thẻ';
    case 'card.restore':
      return 'đã khôi phục thẻ';
    case 'member.add':
      return `đã thêm ${d.memberName ?? ''} vào thẻ`;
    case 'member.remove':
      return `đã bỏ ${d.memberName ?? ''} khỏi thẻ`;
    case 'checklist.add':
      return `đã thêm việc cần làm "${d.title ?? ''}"`;
    case 'attachment.add':
      return `đã đính kèm tệp "${d.name ?? ''}"`;
    case 'comment.create':
      return `đã bình luận: ${d.text ?? ''}`;
    case 'ai.board.create':
      return `đã tạo bảng này bằng AI (${d.cardCount ?? '?'} thẻ)`;
    default:
      return a.type;
  }
}
