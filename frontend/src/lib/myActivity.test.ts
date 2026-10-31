import { describe, expect, it } from 'vitest';
import { dayLabel, describeActivity, groupByDay, timeOf } from './myActivity';

const NOW = new Date(2026, 9, 12, 14, 0, 0); // Thứ hai 12/10/2026
const at = (day: number, hour = 9, minute = 5, month = 9) => new Date(2026, month, day, hour, minute, 0).toISOString();

describe('describeActivity', () => {
  it('chuyển thẻ giữa các cột / sang bảng khác', () => {
    expect(describeActivity({ type: 'card.move', data: { fromList: '1.', toList: '3' } })).toMatchObject({ icon: 'move', verb: 'Chuyển thẻ', withCard: true, detail: 'từ 1. sang 3' });
    expect(describeActivity({ type: 'card.move', data: { fromList: 'A', toList: 'B', toBoard: 'Bảng X' } }).detail).toBe('từ A sang bảng “Bảng X” (B)');
  });

  it('trạng thái, hạn, đổi tên, bình luận', () => {
    expect(describeActivity({ type: 'card.status', data: { from: 'TODO', to: 'IN_REVIEW' } }).detail).toBe('từ “Chưa làm” sang “Chờ duyệt”');
    expect(describeActivity({ type: 'card.due.set', data: { dueDate: '2026-10-15T00:00:00.000Z' } })).toMatchObject({ icon: 'due', verb: 'Đặt hạn cho thẻ' });
    expect(describeActivity({ type: 'card.due.clear', data: {} }).verb).toBe('Bỏ hạn của thẻ');
    expect(describeActivity({ type: 'card.rename', data: { from: 'Cũ', to: 'Mới' } }).detail).toBe('(trước đó: “Cũ”)');
    expect(describeActivity({ type: 'comment.create', data: { text: 'Đã review xong' } })).toMatchObject({ icon: 'comment', quote: 'Đã review xong' });
  });

  it('thành viên, checklist, tệp; thiếu dữ liệu vẫn ra câu đọc được (không còn "thẻ thẻ")', () => {
    expect(describeActivity({ type: 'member.add', data: { memberName: 'Lan' } }).verb).toBe('Thêm Lan vào thẻ');
    expect(describeActivity({ type: 'member.add', data: {} }).verb).toBe('Thêm người vào thẻ');
    expect(describeActivity({ type: 'checklist.add', data: { title: 'Kiểm thử' } }).verb).toBe('Thêm checklist “Kiểm thử” vào thẻ');
    expect(describeActivity({ type: 'attachment.add', data: { name: 'a.pdf' } }).verb).toBe('Đính kèm “a.pdf” vào thẻ');
    expect(describeActivity({ type: 'card.done', data: {} })).toMatchObject({ verb: 'Hoàn thành thẻ', icon: 'done' });
  });

  it('tạo bảng bằng AI không gắn với thẻ; loại lạ ra câu chung, không hiện mã', () => {
    expect(describeActivity({ type: 'ai.board.create', data: { cardCount: 24 } })).toMatchObject({ withCard: false, detail: '(24 thẻ)' });
    const unknown = describeActivity({ type: 'x.y.z', data: {} });
    expect(unknown.verb).toBe('Cập nhật thẻ');
    expect(unknown.verb).not.toContain('x.y.z');
  });
});

describe('gom theo ngày', () => {
  it('nhãn ngày: hôm nay, hôm qua, thứ + ngày', () => {
    expect(dayLabel(at(12), NOW)).toBe('Hôm nay');
    expect(dayLabel(at(11, 23, 59), NOW)).toBe('Hôm qua');
    expect(dayLabel(at(6), NOW)).toBe('Thứ ba, 06/10/2026');
    expect(timeOf(at(12, 9, 5))).toBe('09:05');
  });

  it('giữ thứ tự, tách nhóm khi sang ngày khác', () => {
    const items = [
      { id: 'a', createdAt: at(12, 13) },
      { id: 'b', createdAt: at(12, 8) },
      { id: 'c', createdAt: at(11, 22) },
      { id: 'd', createdAt: at(6, 10) },
    ];
    const groups = groupByDay(items, NOW);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Hôm nay', ['a', 'b']],
      ['Hôm qua', ['c']],
      ['Thứ ba, 06/10/2026', ['d']],
    ]);
  });
});
