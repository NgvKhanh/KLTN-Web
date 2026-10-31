import type { AssignConfidenceLevel } from '../types/assign';
import type { ChatAssignChoice } from '../types/chat';
import { CONFIDENCE_LABEL } from './assignLabels';

// Chu hien cho nguoi nhan do HE THONG goi y phan cong chon (Phase 6): khong bang chung, ho so, CV; chi hang / diem / tin cay / co.

const FLAG_TEXT: Record<string, string> = {
  OVERLOADED: 'đang quá tải',
  PAUSED: 'đang tạm nghỉ',
  NO_HISTORY: 'chưa có lịch sử',
  NO_SIMILAR: 'chưa làm việc tương tự',
  NO_PROFILE: 'chưa khai hồ sơ',
  NO_DATA: 'không đủ dữ liệu',
};

/** Điểm hiện là số nguyên 0-100 (làm tròn ở phía hiển thị dù server đã làm tròn: không bao giờ hiện 72.4999…). */
export const scoreText = (score: number): string => String(Math.round(score));

/** "Ứng viên khác: Trần Tuấn (64), Chủ Bảng". */
export function alternativesLine(alternatives: ChatAssignChoice['alternatives']): string {
  return `Ứng viên khác: ${alternatives.map((a) => `${a.name}${a.score === null ? '' : ` (${scoreText(a.score)})`}`).join(', ')}`;
}

/** "Do hệ thống gợi ý · hạng 1 · điểm 82/100 · Đủ dữ liệu". */
export function choiceLine(c: ChatAssignChoice): string {
  const score = c.score === null ? 'chưa đủ dữ liệu để chấm điểm' : `điểm ${scoreText(c.score)}/100`;
  return `Do hệ thống gợi ý phân công chọn · hạng ${c.rank} · ${score} · ${CONFIDENCE_LABEL[c.confidenceLevel as AssignConfidenceLevel] ?? c.confidenceLevel}`;
}

/** "Lưu ý: đang quá tải, chưa có lịch sử". */
export function flagsLine(flags: readonly string[]): string {
  return `Lưu ý: ${flags.map((f) => FLAG_TEXT[f] ?? f).join(', ')}`;
}
