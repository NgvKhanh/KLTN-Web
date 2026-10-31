// TF-IDF va do giong cosine (ASSIGN_MODULE.md §5.2). HAM THUAN, khong Prisma, khong dong ho.
//
// Kho ngu lieu = moi the cua khong gian lam viec (ca da xong lan dang mo): nguoi goi truyen vao.
//   tf(t,d)  = 1 + ln(so lan)          neu co, nguoc lai khong xuat hien trong vec-to
//   idf(t)   = ln((N+1)/(df+1)) + 1    lam tron: tu chua tung thay (df = 0) co idf LON NHAT, khong chia 0
// Vec-to duoc CHUAN HOA do dai 1 nen do giong = tich vo huong (cosine), luon nam trong [0,1].

export type TermCounts = ReadonlyMap<string, number>;
export type SparseVector = ReadonlyMap<string, number>;

export interface Idf {
  /** So tai lieu (the) trong kho, ke ca the khong co thuat ngu nao. */
  readonly docCount: number;
  /** So tai lieu chua tung thuat ngu. */
  readonly df: ReadonlyMap<string, number>;
}

/** Dung IDF tu kho ngu lieu. Moi phan tu la so lan cua tung thuat ngu trong MOT the. */
export function buildIdf(docs: Iterable<TermCounts>): Idf {
  const df = new Map<string, number>();
  let docCount = 0;
  for (const doc of docs) {
    docCount += 1;
    // Chi dem thuat ngu co so lan > 0: "co mat" moi tinh vao df
    for (const [term, count] of doc) {
      if (count > 0) df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  return { docCount, df };
}

export function idfOf(idf: Idf, term: string): number {
  const df = idf.df.get(term) ?? 0;
  return Math.log((idf.docCount + 1) / (df + 1)) + 1;
}

/** Vec-to TF-IDF chuan hoa do dai 1. The khong co thuat ngu nao -> vec-to rong (moi do giong = 0). */
export function vectorize(counts: TermCounts, idf: Idf): SparseVector {
  const raw = new Map<string, number>();
  let sumSquares = 0;
  for (const [term, count] of counts) {
    if (!Number.isFinite(count) || count <= 0) continue;
    const w = (1 + Math.log(count)) * idfOf(idf, term);
    raw.set(term, w);
    sumSquares += w * w;
  }
  if (raw.size === 0 || sumSquares === 0) return new Map();
  const norm = Math.sqrt(sumSquares);
  const unit = new Map<string, number>();
  for (const [term, w] of raw) unit.set(term, w / norm);
  return unit;
}

/**
 * Nhu vectorize nhung BO cac thuat ngu co df = 0 (chua tung xuat hien trong kho the) TRUOC khi chuan hoa - dung cho muc ho so tu
 * khai (§17.4). idfOf cho tu la idf LON NHAT, nen giu chung thi mot van ban nhieu tu ngoai linh vuc (dia chi, truong hoc...) bi keo
 * do giong xuong ma khong the nao khop them. Bo di khong mat tu nao co the khop: the dang cham luon nam trong kho.
 */
export function vectorizeKnown(counts: TermCounts, idf: Idf): SparseVector {
  const known = new Map<string, number>();
  for (const [term, count] of counts) {
    if ((idf.df.get(term) ?? 0) > 0) known.set(term, count);
  }
  return vectorize(known, idf);
}

/** Cosine cua hai vec-to DA chuan hoa. Ket qua trong [0,1]; vec-to rong -> 0. */
export function cosine(a: SparseVector, b: SparseVector): number {
  if (a.size === 0 || b.size === 0) return 0;
  // Duyet vec-to nho hon; tong theo thu tu chen cua no -> ket qua tat dinh
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, w] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += w * other;
  }
  // Sai so lam tron co the cho 1.0000000000000002
  return Math.min(1, Math.max(0, dot));
}
