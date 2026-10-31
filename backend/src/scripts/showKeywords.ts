// Chay thu buoc 3 cua module goi y phan cong (ASSIGN_MODULE.md): tach tu -> TF-IDF -> ho so nguoi.
// CHAY TAY, khong ghi CSDL, khong import prisma:
//
//   npm run assign:keywords                 bo du lieu mo phong mac dinh
//   npm run assign:keywords -- --seed=7 --top=10
//
// In (1) top thuat ngu cua tung nguoi, canh ky nang AN cua ho de mat thuong doi chieu; (2) phep do
// "lang gieng gan nhat cua mot the co CUNG CHU DE khong" - cach duy nhat de biet chuoi xu ly chu co
// phan biet duoc chu de hay khong (test chi kiem co hoc, khong kiem duoc dieu nay).
//
// LUU Y PHUONG PHAP: script nay DOC chu de an va ky nang an (dung de DANH GIA); module assign/ thi
// khong bao gio duoc thay chung.

import { buildProfile, topTerms, type HistoryCard } from '../modules/assign/assign.profile';
import { countTerms } from '../modules/assign/assign.text';
import { buildIdf, type TermCounts } from '../modules/assign/assign.tfidf';
import { DEFAULT_SIM, generateSimulation, type SimCard } from './simGenerator';
import { simDayToDate, vnToday } from './simSeed';
import { neighbourAccuracy } from './simTextEval';
import { TOPICS } from './simVocab';

function parseArgs(argv: string[]) {
  let seed = DEFAULT_SIM.seed;
  let top = 8;
  for (const arg of argv) {
    if (arg.startsWith('--seed=')) seed = Number(arg.slice(7));
    else if (arg.startsWith('--top=')) top = Number(arg.slice(6));
    else {
      console.error(`Tham so la "${arg}" (chi co --seed=N va --top=N)`);
      process.exit(1);
    }
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    console.error('--seed phai la so nguyen tu 0 den 4294967295');
    process.exit(1);
  }
  if (!Number.isInteger(top) || top < 1 || top > 50) {
    console.error('--top phai la so nguyen tu 1 den 50');
    process.exit(1);
  }
  return { seed, top };
}

interface Variant {
  name: string;
  counts: (c: SimCard) => TermCounts;
}

const stripBigrams = (m: Map<string, number>): Map<string, number> =>
  new Map([...m].filter(([term]) => !term.includes(' ')));

function main() {
  const { seed, top } = parseArgs(process.argv.slice(2));
  const data = generateSimulation({ ...DEFAULT_SIM, seed });
  const today = vnToday();
  const at = (day: number, hour = 0) => simDayToDate(today, data.config.days, day, hour);
  const now = at(data.config.days, 12);

  const idf = buildIdf(data.cards.map((c) => countTerms(c)));
  console.log(`Bo du lieu: hat giong ${seed} - ${data.people.length} nguoi, ${data.cards.length} the.`);
  console.log(`Kho ngu lieu: ${idf.docCount} the, ${idf.df.size} thuat ngu khac nhau.\n`);

  for (const p of data.people) {
    const history: HistoryCard[] = data.cards
      .filter((c) => c.assigneeKey === p.key && c.done && c.completedDay !== null)
      .map((c) => ({
        cardId: c.key,
        title: c.title,
        description: c.description,
        completedAt: at(c.completedDay!, 17),
      }));
    const profile = buildProfile(p.key, history, idf, now);
    const strong = p.skills
      .map((s, t) => ({ s, t }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 2)
      .map((x) => `${TOPICS[x.t]!.name} ${x.s.toFixed(2)}`)
      .join(', ');
    console.log(`${p.key} ${p.name}: ${profile.entries.length} the da xong | manh (AN): ${strong}`);
    console.log(
      '   ' +
        topTerms(profile, top)
          .map((t) => `${t.term} ${t.weight.toFixed(2)}`)
          .join(' · ')
    );
  }

  const variants: Variant[] = [
    { name: 'uni-gram + bi-gram, tieu de x2 (mac dinh)', counts: (c) => countTerms(c) },
    { name: 'chi uni-gram, tieu de x2', counts: (c) => stripBigrams(countTerms(c)) },
    { name: 'uni + bi, tieu de x1 (ngang mo ta)', counts: (c) => countTerms(c, 1) },
    { name: 'uni + bi, chi tieu de', counts: (c) => countTerms({ title: c.title }) },
    { name: 'uni + bi, chi mo ta', counts: (c) => countTerms({ title: '', description: c.description }, 0) },
  ];
  console.log('\nLang gieng gan nhat cua mot the co CUNG chu de an khong? (the mo ho khong lam truy van)');
  for (const v of variants) {
    const r = neighbourAccuracy(data, v.counts);
    console.log(
      `  ${v.name.padEnd(44)} top-1 ${(r.top1 * 100).toFixed(1)}%   P@5 ${(r.p5 * 100).toFixed(1)}%   (ngau nhien ${(r.chance * 100).toFixed(1)}%, ${r.queries} truy van)`
    );
  }
}

main();
