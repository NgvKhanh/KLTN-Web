// Nguong muc nguy co (RISK_MODULE.md §1, do user dat) va cac hang so bao (§8.3). HAM THUAN.

export type RiskLevel = 'SAFE' | 'WATCH' | 'WARNING' | 'CRITICAL';

export const RISK_LEVELS: readonly RiskLevel[] = ['SAFE', 'WATCH', 'WARNING', 'CRITICAL'];
export const LEVEL_RANK: Readonly<Record<RiskLevel, number>> = { SAFE: 0, WATCH: 1, WARNING: 2, CRITICAL: 3 };

/** Muc thap nhat duoc gui thong bao + email (user chot: tu Canh bao, >= 51%). */
export const NOTIFY_MIN_LEVEL: RiskLevel = 'WARNING';
/** Vung dem: muc da bao chi xoa khi diem xuong <= nguong nay (hoac doi han) - the nhay quanh 51 khong bao lap. */
export const NOTIFY_RESET_SCORE = 40;
/** Toi da so email canh bao nguy co cho MOT nguoi trong 24 gio; vuot thi chi con thong bao trong app (§8.3). */
export const RISK_EMAIL_DAILY_CAP = 20;

/** Xac suat -> diem nguyen 0-100. Xac suat khong hop le la loi lap trinh. */
export function scoreOf(probability: number): number {
  if (!Number.isFinite(probability)) throw new RangeError('xac suat khong hop le');
  return Math.min(100, Math.max(0, Math.round(probability * 100)));
}

/** 0-25 An toan, 26-50 Theo doi, 51-75 Canh bao, 76-100 Nguy cap. */
export function levelOf(score: number): RiskLevel {
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new RangeError('diem phai la so nguyen 0-100');
  if (score <= 25) return 'SAFE';
  if (score <= 50) return 'WATCH';
  if (score <= 75) return 'WARNING';
  return 'CRITICAL';
}
