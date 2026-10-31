import { describe, expect, it } from 'vitest';
import { activityPhrase } from './activityText';

describe('activityPhrase', () => {
  it('ai.board.create hien so the thay vi ma tho', () => {
    expect(activityPhrase({ type: 'ai.board.create', data: { cardCount: 5, runId: 'r1' } })).toBe(
      'đã tạo bảng này bằng AI (5 thẻ)'
    );
  });

  it('ai.board.create thieu cardCount -> dau "?" chu khong phai "undefined"', () => {
    expect(activityPhrase({ type: 'ai.board.create', data: {} })).toBe('đã tạo bảng này bằng AI (? thẻ)');
  });

  it('loai chua biet van tra ve ma tho (hanh vi co san khong bi doi)', () => {
    expect(activityPhrase({ type: 'loai.la', data: {} })).toBe('loai.la');
    expect(activityPhrase({ type: 'card.rename', data: {} })).toBe('đã đổi tên thẻ');
  });
});

describe('activityPhrase - trang thai the', () => {
  it('card.status hien nhan tieng Viet cua 2 trang thai', () => {
    expect(activityPhrase({ type: 'card.status', data: { from: 'TODO', to: 'IN_REVIEW' } })).toBe(
      'đã chuyển trạng thái thẻ từ "Chưa làm" sang "Chờ duyệt"'
    );
  });

  it('card.done / card.undone kem from-to van giu cum tu cu', () => {
    expect(activityPhrase({ type: 'card.done', data: { from: 'IN_PROGRESS', to: 'DONE' } })).toBe(
      'đã đánh dấu thẻ hoàn thành'
    );
    expect(activityPhrase({ type: 'card.undone', data: { from: 'DONE', to: 'TODO' } })).toBe(
      'đã bỏ đánh dấu hoàn thành'
    );
  });
});
