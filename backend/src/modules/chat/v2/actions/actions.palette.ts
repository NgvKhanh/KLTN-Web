// BANG MAU cua giao dien (anh bia the, mau nhan, mau nen bang): MUOT bo 10 mau hex co dinh. Mo hinh chi chon TEN mau (enum); backend doi sang hex
// va kiem lai mau do co duoc nhac trong cau nguoi dung (khong tu chon mau thay nguoi dung). Ham thuan, khong CSDL.

import { hasAny, type Phrase } from './actions.text';

export const COLOR_NAMES = ['GREEN', 'YELLOW', 'ORANGE', 'RED', 'PURPLE', 'BLUE', 'SKY', 'LIME', 'PINK', 'GRAY'] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

/** Giong COVER_COLORS / LABEL_COLORS cua frontend (cardModal/helpers.ts, LabelPanel.tsx): backend nhan hex bat ky nhung chatbot chi dung bo nay. */
export const COLOR_HEX: Record<ColorName, string> = {
  GREEN: '#4bce97',
  YELLOW: '#f5cd47',
  ORANGE: '#fea362',
  RED: '#f87168',
  PURPLE: '#9f8fef',
  BLUE: '#579dff',
  SKY: '#6cc3e0',
  LIME: '#94c748',
  PINK: '#e774bb',
  GRAY: '#8590a2',
};

export const COLOR_VI: Record<ColorName, string> = {
  GREEN: 'xanh lá',
  YELLOW: 'vàng',
  ORANGE: 'cam',
  RED: 'đỏ',
  PURPLE: 'tím',
  BLUE: 'xanh dương',
  SKY: 'xanh da trời',
  LIME: 'xanh chuối',
  PINK: 'hồng',
  GRAY: 'xám',
};

/** Cach nguoi dung goi mau (da bo dau, thuong). "xanh" tran (khong "la" / "duong"...) KHONG nhan dien: mau mo ho thi phai hoi lai. */
const COLOR_PHRASES: Record<ColorName, readonly Phrase[]> = {
  GREEN: [['xanh', 'la'], ['xanh', 'luc'], ['green'], ['luc']],
  YELLOW: [['vang'], ['yellow']],
  ORANGE: [['cam'], ['orange']],
  RED: [['do'], ['red']],
  PURPLE: [['tim'], ['purple'], ['violet']],
  BLUE: [['xanh', 'duong'], ['xanh', 'nuoc', 'bien'], ['blue']],
  SKY: [['xanh', 'da', 'troi'], ['xanh', 'nhat'], ['xanh', 'ngoc'], ['sky'], ['cyan']],
  LIME: [['xanh', 'chuoi'], ['xanh', 'non'], ['lime']],
  PINK: [['hong'], ['pink']],
  GRAY: [['xam'], ['gray'], ['grey'], ['bac']],
};

/** Cau co nhac toi mau nay khong. */
export function colorMentioned(color: ColorName, words: readonly string[]): boolean {
  return hasAny(words, COLOR_PHRASES[color]);
}

const HEX_TO_NAME = new Map<string, ColorName>(COLOR_NAMES.map((n) => [COLOR_HEX[n], n]));
/** Ten mau tieng Viet cua mot ma hex (hex ngoai bang -> chinh ma hex), de hien trong ban xem truoc. */
export function colorLabel(hex: string | null | undefined): string {
  if (!hex) return 'không có';
  const name = HEX_TO_NAME.get(hex.toLowerCase());
  return name !== undefined ? COLOR_VI[name] : hex;
}
