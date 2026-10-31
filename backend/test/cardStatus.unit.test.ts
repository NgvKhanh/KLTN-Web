import { describe, expect, it } from 'vitest';
import {
  guessListStatus,
  initialStatusData,
  reopenStatus,
} from '../src/modules/card/cardStatus';

describe('guessListStatus - doan trang thai tu ten cot', () => {
  it.each([
    // Ten cot trong cac mau bang co san (boardTemplates.ts)
    ['Cần làm', 'TODO'],
    ['Việc cần làm', 'TODO'],
    ['Product Backlog', 'TODO'],
    ['Sprint Backlog', 'TODO'],
    ['Đang làm', 'IN_PROGRESS'],
    ['Đang thực hiện', 'IN_PROGRESS'],
    ['Đang viết', 'IN_PROGRESS'],
    ['Đang nghiên cứu', 'IN_PROGRESS'],
    ['Đang review', 'IN_REVIEW'],
    ['Kiểm thử', 'IN_REVIEW'],
    ['Chờ duyệt', 'IN_REVIEW'],
    ['Chờ GVHD phản hồi', 'IN_REVIEW'],
    ['Hoàn thành', 'DONE'],
    ['Xong', 'DONE'],
    ['Đã đăng', 'DONE'],
    ['Đã chỉnh sửa xong', 'DONE'],
    ['Tạm hoãn', 'BLOCKED'],
    ['Đang chờ', 'BLOCKED'],
    // Tieng Anh + viet hoa/khong dau
    ['To do', 'TODO'],
    ['TODO', 'TODO'],
    ['In progress', 'IN_PROGRESS'],
    ['Doing', 'IN_PROGRESS'],
    ['Done', 'DONE'],
    ['Blocked', 'BLOCKED'],
    ['hoan thanh', 'DONE'],
    ['DANG LAM', 'IN_PROGRESS'],
    // Ca bay: thu tu uu tien giua cac nhom
    ['Chưa hoàn thành', 'TODO'],
    ['Chưa xong', 'TODO'],
    ['Đang chờ duyệt', 'IN_REVIEW'],
    ['Bị chặn', 'BLOCKED'],
  ] as const)('"%s" -> %s', (name, expected) => {
    expect(guessListStatus(name)).toBe(expected);
  });

  it.each(['Ý tưởng', 'Hôm nay', 'Tuần này', 'Sau này', 'Đã lên lịch', 'Tài liệu cần đọc', 'Undone', 'Khác', ''])(
    '"%s" -> null (cot tu do)',
    (name) => {
      expect(guessListStatus(name)).toBeNull();
    }
  );

  it('so khop theo ca tu, khong khop giua tu', () => {
    // "qa" khong duoc khop trong "quan"; "done" khong khop trong "undone"
    expect(guessListStatus('Quản lý')).toBeNull();
    expect(guessListStatus('QA')).toBe('IN_REVIEW');
  });
});

describe('initialStatusData - trang thai the moi tao', () => {
  it('cot tu do -> TODO, chua xong', () => {
    expect(initialStatusData(null)).toEqual({ status: 'TODO', isDone: false, completedAt: null });
  });

  it('cot DONE -> xong ngay, co completedAt', () => {
    const d = initialStatusData('DONE');
    expect(d.status).toBe('DONE');
    expect(d.isDone).toBe(true);
    expect(d.completedAt).toBeInstanceOf(Date);
  });

  it('cot khac -> theo cot, chua xong', () => {
    expect(initialStatusData('BLOCKED')).toEqual({ status: 'BLOCKED', isDone: false, completedAt: null });
  });
});

describe('reopenStatus - mo lai the da xong', () => {
  it('theo cot neu cot co trang thai khac DONE', () => {
    expect(reopenStatus('IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(reopenStatus('IN_REVIEW')).toBe('IN_REVIEW');
  });

  it('cot DONE hoac cot tu do -> TODO', () => {
    expect(reopenStatus('DONE')).toBe('TODO');
    expect(reopenStatus(null)).toBe('TODO');
    expect(reopenStatus(undefined)).toBe('TODO');
  });
});
