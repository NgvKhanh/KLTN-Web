import type {
  AssignConfidenceLevel,
  AssignDeclaredEvidence,
  AssignEvidenceOutcome,
  AssignFlag,
  AssignWeightKey,
} from '../types/assign';

// Nhan tieng Viet cua module goi y phan cong - o MOT cho de hai panel (o Thanh vien va trang cai dat) noi cung mot cach.

export const COMPONENT_LABEL: Record<AssignWeightKey, string> = {
  experience: 'Kinh nghiệm',
  reliability: 'Độ tin cậy',
  availability: 'Khả dụng',
  declared: 'Hồ sơ',
};

export const COMPONENT_SHORT: Record<AssignWeightKey, string> = {
  experience: 'KN',
  reliability: 'TC',
  availability: 'KD',
  declared: 'HS',
};

/** Vi sao thanh phan nay co y nghia (tooltip). */
export const COMPONENT_HINT: Record<AssignWeightKey, string> = {
  experience: 'Mức độ giống giữa thẻ này và những thẻ người đó đã hoàn thành trước đây',
  reliability: 'Tỉ lệ đúng hạn của người đó ở những thẻ giống thẻ này',
  availability: 'Còn bao nhiêu chỗ trống: 1 trừ (số thẻ đang mở chồng lấn / số thẻ song song tối đa)',
  declared: 'Mức khớp giữa thẻ này và kỹ năng, công việc đã làm, CV mà người đó TỰ KHAI (chưa được kiểm chứng bằng lịch sử)',
};

/** Loai muc ho so tu khai (bang chung Ho so). */
export const DECLARED_KIND_LABEL: Record<AssignDeclaredEvidence['kind'], string> = {
  SKILL: 'Kỹ năng',
  WORK: 'Công việc đã làm',
  CV: 'CV',
};

export const CONFIDENCE_LABEL: Record<AssignConfidenceLevel, string> = {
  THIN: 'Dữ liệu mỏng',
  FAIR: 'Vừa đủ dữ liệu',
  GOOD: 'Đủ dữ liệu',
};

export const OUTCOME_LABEL: Record<AssignEvidenceOutcome, string> = {
  ON_TIME: 'Đúng hạn',
  ON_TIME_REOPENED: 'Đúng hạn (từng mở lại)',
  LATE: 'Trễ hạn',
  NO_DUE: 'Không có hạn',
};

/** Hai cờ khiến giao tay phải hoi lai mot lan: nguoi do dang qua tai hoac dang tam nghi. */
export const RISKY_FLAGS: readonly AssignFlag[] = ['OVERLOADED', 'PAUSED'];

export function flagLabel(flag: AssignFlag, s: { load: number; capacity: number }): string {
  switch (flag) {
    case 'OVERLOADED':
      return `Quá tải (${s.load}/${s.capacity} thẻ)`;
    case 'PAUSED':
      return 'Đang tạm nghỉ';
    case 'NO_HISTORY':
      return 'Chưa có lịch sử';
    case 'NO_SIMILAR':
      return 'Chưa làm việc tương tự';
    case 'NO_PROFILE':
      return 'Chưa khai hồ sơ';
    case 'NO_DATA':
      return 'Không đủ dữ liệu';
  }
}

/** Cau canh bao khi nguoi dung sap giao cho nguoi mang co OVERLOADED / PAUSED. */
export function riskWarning(name: string, flags: readonly AssignFlag[], s: { load: number; capacity: number }): string | null {
  const parts: string[] = [];
  if (flags.includes('PAUSED')) parts.push('đang tạm nghỉ');
  if (flags.includes('OVERLOADED')) parts.push(`đang quá tải (${s.load}/${s.capacity} thẻ chồng lấn)`);
  return parts.length > 0 ? `${name} ${parts.join(' và ')}.` : null;
}
