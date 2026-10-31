// HAM DUNG CHUNG cua cac nhom thao tac mo rong (actions/ops): ngoac kep hien thi, cat chuoi, chon MOT thuc the con (binh luan, muc checklist, tep, cot da
// luu tru...) trong mot tap, bang CUNG co che nut chon cua cac tham chieu khac (PendingChoice + presets theo dau van tay).

import { selectMatches } from '../../chat.v2.entities';
import { foldWords } from '../actions.text';
import type { ChildKind } from '../actions.types';
import type { OpHit, OpResolveResult, ResolveCtx } from './ops.types';

/** Toi da bay nhieu nut chon (bang actions.resolve.MAX_CHOICES). */
export const MAX_CHOICES = 8;

export const q = (s: string | undefined | null): string => `“${s ?? ''}”`;

/** Cat van ban dai de hien trong khung xem truoc (dem theo ky tu Unicode). */
export const clip = (text: string, max: number): string => (Array.from(text).length > max ? `${Array.from(text).slice(0, max).join('')}…` : text);

export interface PoolItem {
  id: string;
  name: string;
  parentName?: string;
}

const NOUN_OF: Record<ChildKind, string> = {
  comment: 'bình luận',
  item: 'mục checklist',
  checklist: 'checklist',
  attachment: 'tệp đính kèm',
  rule: 'luật tự động hóa',
  field: 'trường tùy chỉnh',
  template: 'thẻ mẫu',
  archivedCard: 'thẻ đã lưu trữ',
  archivedList: 'cột đã lưu trữ',
  option: 'lựa chọn',
};

/**
 * Chon MOT phan tu trong `pool` theo chu `text` (rong = "khong noi gi": chi hop le khi pool co dung mot phan tu). Tra Hit, hoac ket qua dung som:
 * nut chon (nhieu phan tu khop) / loi (khong thay, qua nhieu). `scope`: dinh danh pham vi (id the, id bang) de dau van tay nut chon khong lan giua cac the.
 * Nguoi dung da bam chon thi dung lai lua chon do (kiem lai con nam trong pool).
 */
export function chooseFrom(args: { rc: ResolveCtx; kind: ChildKind; scope: string; text: string; pool: readonly PoolItem[]; where?: string }): OpHit | OpResolveResult {
  const { rc, kind, scope, pool } = args;
  const text = args.text.trim();
  const noun = NOUN_OF[kind];
  const where = args.where ?? '';
  const sig = `${kind}:${scope}:${foldWords(text).join(' ')}`;
  const preset = rc.h.preset(sig);
  if (preset !== undefined) {
    const hit = pool.find((p) => p.id === preset);
    return hit ? { id: hit.id, name: hit.name, ...(hit.parentName !== undefined ? { parentName: hit.parentName } : {}) } : { kind: 'FAIL', code: 'NOT_FOUND', text: `Không còn tìm thấy ${noun} đã chọn${where}. Chưa thay đổi gì.` };
  }
  // khop theo cum lien tiep truoc; khong thay thi khop theo tung tu (nguoi dung nho noi dung khong dung thu tu)
  let found: PoolItem[] = text === '' ? [...pool] : selectMatches(text, [...pool]);
  if (found.length === 0 && text !== '') found = pool.filter((p) => containsWords(p.name, text));
  if (found.length === 0) {
    return { kind: 'FAIL', code: 'NOT_FOUND', text: `Không tìm thấy ${noun}${text === '' ? '' : ` ${q(text)}`}${where}. Chưa thay đổi gì.` };
  }
  if (found.length === 1) return { id: found[0].id, name: found[0].name, ...(found[0].parentName !== undefined ? { parentName: found[0].parentName } : {}) };
  if (found.length > MAX_CHOICES) {
    const which = text === '' ? `Hãy nói rõ ${noun} nào` : `Có ${found.length} ${noun} khớp ${q(text)}. Hãy nêu rõ hơn`;
    return { kind: 'FAIL', code: 'AMBIGUOUS', text: `${which}${where}. Chưa thay đổi gì.` };
  }
  return {
    kind: 'CHOICE',
    pending: { sig, kind, text, options: found.map((h) => ({ id: h.id, label: h.parentName !== undefined && h.parentName !== '' ? `${h.name} · ${h.parentName}` : h.name })) },
  };
}

/** Cac chu cua mot cau co hop voi mot doan van ban khong (bo dau, chua du moi tu cua doan). Dung de khop `match` voi noi dung that. */
export function containsWords(haystack: string, needle: string): boolean {
  const have = new Set(foldWords(haystack));
  const want = foldWords(needle);
  return want.length > 0 && want.every((w) => have.has(w));
}
