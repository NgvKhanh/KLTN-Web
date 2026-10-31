// Phep do "chuoi tach tu -> TF-IDF co phan biet duoc chu de khong" tren du lieu mo phong.
// Tach rieng khoi showKeywords.ts (co main() chay ngay khi import) de test dung chung, khong nhan ban ma.
//
// DOC chu de an (`topic`) de DANH GIA - nen chi nam trong scripts/, module assign/ khong duoc import.
//
// CANH BAO KHI DIEN GIAI: tu vung mo phong chi co 8 chu de, moi chu de co bo tu rieng, nen con so nay
// la CAN TREN tren mot thi truong do choi - no chi chung minh chuoi xu ly khong hong (so voi ~13% ngau
// nhien), khong chung minh do tot tren van ban that.

import { buildIdf, cosine, vectorize, type TermCounts } from '../modules/assign/assign.tfidf';
import type { SimCard, SimDataset } from './simGenerator';

export interface NeighbourAccuracy {
  /** So the dung lam truy van (the mo ho khong lo chu de nen khong co dap an -> bi loai). */
  queries: number;
  /** Ti le truy van co lang gieng GAN NHAT cung chu de. */
  top1: number;
  /** Trung binh ti le cung chu de trong 5 lang gieng gan nhat. */
  p5: number;
  /** Ti le dat duoc neu chon lang gieng NGAU NHIEN (dung phan bo chu de that cua bo du lieu). */
  chance: number;
}

export function neighbourAccuracy(
  data: SimDataset,
  counts: (card: SimCard) => TermCounts
): NeighbourAccuracy {
  const cards = data.cards;
  const all = cards.map((c) => counts(c));
  const idf = buildIdf(all);
  const vecs = all.map((m) => vectorize(m, idf));

  const perTopic = new Map<number, number>();
  for (const c of cards) perTopic.set(c.topic, (perTopic.get(c.topic) ?? 0) + 1);

  let queries = 0;
  let hit1 = 0;
  let hit5 = 0;
  let chance = 0;
  for (let i = 0; i < cards.length; i += 1) {
    const q = cards[i]!;
    if (q.ambiguous) continue;
    const scored: { j: number; sim: number }[] = [];
    for (let j = 0; j < cards.length; j += 1) {
      if (j !== i) scored.push({ j, sim: cosine(vecs[i]!, vecs[j]!) });
    }
    // Hoa diem -> the co chi so nho hon (tat dinh)
    scored.sort((a, b) => b.sim - a.sim || a.j - b.j);
    queries += 1;
    if (cards[scored[0]!.j]!.topic === q.topic) hit1 += 1;
    const five = scored.slice(0, 5);
    hit5 += five.filter((s) => cards[s.j]!.topic === q.topic).length / five.length;
    chance += ((perTopic.get(q.topic) ?? 1) - 1) / (cards.length - 1);
  }
  if (queries === 0) return { queries: 0, top1: 0, p5: 0, chance: 0 };
  return { queries, top1: hit1 / queries, p5: hit5 / queries, chance: chance / queries };
}
