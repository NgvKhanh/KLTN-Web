import { describe, expect, it } from 'vitest';
import type { AssignFlag } from '../types/assign';
import {
  COMPONENT_HINT,
  COMPONENT_LABEL,
  COMPONENT_SHORT,
  CONFIDENCE_LABEL,
  DECLARED_KIND_LABEL,
  OUTCOME_LABEL,
  RISKY_FLAGS,
  flagLabel,
  riskWarning,
} from './assignLabels';

const ALL_FLAGS: AssignFlag[] = ['NO_HISTORY', 'NO_SIMILAR', 'NO_PROFILE', 'OVERLOADED', 'PAUSED', 'NO_DATA'];
const S = { load: 6, capacity: 5 };

describe('nhan tieng Viet', () => {
  it('du nhan cho moi khoa (khong thieu khi backend them gia tri)', () => {
    const KEYS = ['availability', 'declared', 'experience', 'reliability'];
    expect(Object.keys(COMPONENT_LABEL).sort()).toEqual(KEYS);
    expect(Object.keys(COMPONENT_SHORT).sort()).toEqual(KEYS);
    expect(Object.keys(COMPONENT_HINT).sort()).toEqual(KEYS);
    expect(Object.keys(DECLARED_KIND_LABEL).sort()).toEqual(['CV', 'SKILL', 'WORK']);
    expect(Object.keys(CONFIDENCE_LABEL).sort()).toEqual(['FAIR', 'GOOD', 'THIN']);
    expect(Object.keys(OUTCOME_LABEL).sort()).toEqual(['LATE', 'NO_DUE', 'ON_TIME', 'ON_TIME_REOPENED']);
    for (const f of ALL_FLAGS) expect(flagLabel(f, S).length, f).toBeGreaterThan(3);
  });

  it('nhan cu the: bon thanh phan, loai muc ho so, muc tin cay, ket qua the cu', () => {
    expect(COMPONENT_LABEL).toEqual({ experience: 'Kinh nghiệm', reliability: 'Độ tin cậy', availability: 'Khả dụng', declared: 'Hồ sơ' });
    expect(COMPONENT_SHORT).toEqual({ experience: 'KN', reliability: 'TC', availability: 'KD', declared: 'HS' });
    expect(COMPONENT_HINT.declared).toContain('TỰ KHAI');
    expect(DECLARED_KIND_LABEL).toEqual({ SKILL: 'Kỹ năng', WORK: 'Công việc đã làm', CV: 'CV' });
    expect(CONFIDENCE_LABEL).toEqual({ THIN: 'Dữ liệu mỏng', FAIR: 'Vừa đủ dữ liệu', GOOD: 'Đủ dữ liệu' });
    expect(OUTCOME_LABEL.ON_TIME).toBe('Đúng hạn');
    expect(OUTCOME_LABEL.LATE).toBe('Trễ hạn');
  });

  it('flagLabel: qua tai ghi ro so the / suc chua, cac co khac khong phu thuoc', () => {
    expect(flagLabel('OVERLOADED', S)).toBe('Quá tải (6/5 thẻ)');
    expect(flagLabel('OVERLOADED', { load: 2, capacity: 1 })).toBe('Quá tải (2/1 thẻ)');
    expect(flagLabel('PAUSED', S)).toBe('Đang tạm nghỉ');
    expect(flagLabel('NO_HISTORY', S)).toBe('Chưa có lịch sử');
    expect(flagLabel('NO_SIMILAR', S)).toBe('Chưa làm việc tương tự');
    expect(flagLabel('NO_DATA', S)).toBe('Không đủ dữ liệu');
    expect(flagLabel('NO_PROFILE', S)).toBe('Chưa khai hồ sơ');
  });
});

describe('riskWarning - cau canh bao truoc khi giao tay', () => {
  it('chi hai co rui ro (OVERLOADED, PAUSED) moi sinh canh bao', () => {
    expect([...RISKY_FLAGS]).toEqual(['OVERLOADED', 'PAUSED']);
    expect(riskWarning('Bob', [], S)).toBeNull();
    expect(riskWarning('Bob', ['NO_HISTORY', 'NO_SIMILAR', 'NO_PROFILE', 'NO_DATA'], S)).toBeNull();
  });

  it('noi dung: qua tai, tam nghi, va ca hai (tam nghi noi truoc)', () => {
    expect(riskWarning('Bob', ['OVERLOADED'], S)).toBe('Bob đang quá tải (6/5 thẻ chồng lấn).');
    expect(riskWarning('Bob', ['PAUSED'], S)).toBe('Bob đang tạm nghỉ.');
    expect(riskWarning('Lan', ['OVERLOADED', 'PAUSED', 'NO_HISTORY'], S)).toBe('Lan đang tạm nghỉ và đang quá tải (6/5 thẻ chồng lấn).');
  });
});
