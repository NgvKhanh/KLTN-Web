// Mo ta + gom nhom nhat ky "Hoat dong cua toi". HAM THUAN: nhan `now` de kiem thu duoc.
import { statusLabel } from './cardStatus';

export type ActivityIcon = 'create' | 'move' | 'rename' | 'done' | 'reopen' | 'status' | 'due' | 'comment' | 'member' | 'attach' | 'checklist' | 'archive' | 'ai' | 'other';

export interface ActivityLike {
  type: string;
  data: Record<string, unknown>;
}

export interface ActivityText {
  icon: ActivityIcon;
  /** Phan dau cau, truoc ten the: "Chuyển thẻ", "Thêm Lan vào thẻ". */
  verb: string;
  /** Co ten the nam giua `verb` va `detail` khong (ai.board.create khong gan voi the nao). */
  withCard: boolean;
  /** Phan sau ten the: "từ Cần làm sang Đang làm". */
  detail?: string;
  /** Doan trich (noi dung binh luan). */
  quote?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const q = (s: string): string => `“${s}”`;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Cau mo ta mot dong nhat ky, tach phan truoc / sau ten the de giao dien chen lien ket the vao giua. */
export function describeActivity(a: ActivityLike): ActivityText {
  const d = a.data;
  switch (a.type) {
    case 'card.create':
      return { icon: 'create', verb: 'Tạo thẻ', withCard: true, ...(str(d.listName) ? { detail: `trong cột ${str(d.listName)}` } : {}) };
    case 'card.move': {
      const toBoard = str(d.toBoard);
      const detail = toBoard ? `từ ${str(d.fromList)} sang bảng ${q(toBoard)} (${str(d.toList)})` : `từ ${str(d.fromList)} sang ${str(d.toList)}`;
      return { icon: 'move', verb: 'Chuyển thẻ', withCard: true, detail };
    }
    case 'card.rename':
      return { icon: 'rename', verb: 'Đổi tên thẻ', withCard: true, ...(str(d.from) ? { detail: `(trước đó: ${q(str(d.from))})` } : {}) };
    case 'card.done':
      return { icon: 'done', verb: 'Hoàn thành thẻ', withCard: true };
    case 'card.undone':
      return { icon: 'reopen', verb: 'Mở lại thẻ', withCard: true };
    case 'card.status':
      return { icon: 'status', verb: 'Đổi trạng thái thẻ', withCard: true, detail: `từ ${q(statusLabel(d.from))} sang ${q(statusLabel(d.to))}` };
    case 'card.due.set': {
      const due = fmtDate(str(d.dueDate) || str(d.to));
      return { icon: 'due', verb: 'Đặt hạn cho thẻ', withCard: true, ...(due ? { detail: `là ${due}` } : {}) };
    }
    case 'card.due.clear':
      return { icon: 'due', verb: 'Bỏ hạn của thẻ', withCard: true };
    case 'card.archive':
      return { icon: 'archive', verb: 'Lưu trữ thẻ', withCard: true };
    case 'card.restore':
      return { icon: 'archive', verb: 'Khôi phục thẻ', withCard: true };
    case 'comment.create':
      return { icon: 'comment', verb: 'Bình luận trong thẻ', withCard: true, ...(str(d.text) ? { quote: str(d.text) } : {}) };
    case 'member.add':
      return { icon: 'member', verb: str(d.memberName) ? `Thêm ${str(d.memberName)} vào thẻ` : 'Thêm người vào thẻ', withCard: true };
    case 'member.remove':
      return { icon: 'member', verb: str(d.memberName) ? `Bỏ ${str(d.memberName)} khỏi thẻ` : 'Bỏ người khỏi thẻ', withCard: true };
    case 'checklist.add':
      return { icon: 'checklist', verb: str(d.title) ? `Thêm checklist ${q(str(d.title))} vào thẻ` : 'Thêm checklist vào thẻ', withCard: true };
    case 'attachment.add':
      return { icon: 'attach', verb: str(d.name) ? `Đính kèm ${q(str(d.name))} vào thẻ` : 'Đính kèm tệp vào thẻ', withCard: true };
    case 'ai.board.create':
      return { icon: 'ai', verb: 'Tạo bảng bằng AI', withCard: false, ...(str(d.cardCount) ? { detail: `(${str(d.cardCount)} thẻ)` } : {}) };
    default:
      return { icon: 'other', verb: 'Cập nhật thẻ', withCard: true };
  }
}

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const pad = (n: number): string => String(n).padStart(2, '0');

/** "Hôm nay", "Hôm qua", hoặc "Thứ tư, 07/10/2026". */
export function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  return `${WEEKDAYS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Giờ trong ngày, vd "21:22". */
export function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Gom theo ngay (theo gio may), giu nguyen thu tu dau vao (moi nhat truoc). */
export function groupByDay<T extends { createdAt: string }>(items: readonly T[], now: Date): { label: string; items: T[] }[] {
  const groups: { label: string; key: number; items: T[] }[] = [];
  for (const it of items) {
    const key = startOfDay(new Date(it.createdAt));
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(it);
    else groups.push({ label: dayLabel(it.createdAt, now), key, items: [it] });
  }
  return groups.map(({ label, items: rows }) => ({ label, items: rows }));
}
