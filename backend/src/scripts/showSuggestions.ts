// Xem bo cham cap (assign.score.ts) chay tren du lieu mo phong. CHAY TAY, khong ghi CSDL:
//
//   npm run assign:suggest                      hat giong mac dinh
//   npm run assign:suggest -- --seed=7 --show=6
//
// In (1) top-3 ung vien kem bang chung cho cac the DANG MO hom nay, canh ky nang AN de mat thuong
// doi chieu; (2) PHAT LAI lich su: voi moi the, chi dung thong tin biet duoc luc no duoc giao, xem
// nguoi xep dau co phai "dap an tot nhat" khong; (3) so sanh cach xep hang (cong tho / chuan hoa);
// (4) tach tung thanh phan; (5) do phan tan truoc/sau chuan hoa.
//
// LUU Y PHUONG PHAP: (2)-(5) chi la KIEM TRA NHANH xem bo cham co vo nghia khong va co che dang chay -
// KHONG phai danh gia: chua co nhanh nen, chua quet tham so, chua co khoang tin cay (do la viec cua
// buoc 7). Script DOC ky nang an de danh gia; module assign/ thi khong bao gio duoc thay chung.

import {
  LEGACY_WEIGHTS_V1,
  rankCandidates,
  type MissingPolicy,
  type Normalization,
  type RankedCandidate,
  type Weights,
} from '../modules/assign/assign.score';
import { DEFAULT_SIM, availableAt, generateSimulation, skillAt } from './simGenerator';
import { componentSpread, replay, snapshotAsOf, type ReplayResult } from './simReplay';
import { simDayToDate, vnToday } from './simSeed';
import { TOPICS } from './simVocab';

function parseArgs(argv: string[]) {
  let seed = DEFAULT_SIM.seed;
  let show = 12;
  for (const arg of argv) {
    if (arg.startsWith('--seed=')) seed = Number(arg.slice(7));
    else if (arg.startsWith('--show=')) show = Number(arg.slice(7));
    else {
      console.error(`Tham so la "${arg}" (chi co --seed=N va --show=N)`);
      process.exit(1);
    }
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    console.error('--seed phai la so nguyen tu 0 den 4294967295');
    process.exit(1);
  }
  if (!Number.isInteger(show) || show < 0 || show > 200) {
    console.error('--show phai la so nguyen tu 0 den 200');
    process.exit(1);
  }
  return { seed, show };
}

const fmt = (x: number | null, d = 2) => (x === null ? ' n/a' : x.toFixed(d));
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};

function describe(r: RankedCandidate): string {
  const c = r.components;
  return (
    `#${r.rank} ${r.userId} diem ${r.score === null ? 'n/a' : r.score.toFixed(0)} (${r.confidenceLevel}, ` +
    `kn ${fmt(c.experience.value)} tc ${fmt(c.reliability.value)} kd ${fmt(c.availability.value)}, ` +
    `tai ${r.load}/${r.capacity})${r.flags.length ? ' [' + r.flags.join(',') + ']' : ''}`
  );
}

function main() {
  const { seed, show } = parseArgs(process.argv.slice(2));
  const data = generateSimulation({ ...DEFAULT_SIM, seed });
  const days = data.config.days;
  const at = (d: number, h = 0, m = 0) => simDayToDate(vnToday(), days, d, h, m);

  // ---------- (1) The dang mo hom nay ----------
  const open = data.cards.filter((c) => !c.done);
  const today = availableAt(data.people, days).map((p) => ({ key: p.key, capacity: p.capacity }));
  console.log(`Bo du lieu: hat giong ${seed} - ${data.people.length} nguoi, ${data.cards.length} the, ${open.length} the dang mo.`);
  console.log(`Ung vien hom nay: ${today.map((p) => p.key).join(', ')}\n`);

  for (const c of open.slice(0, show)) {
    const snap = snapshotAsOf(data, days, 12, today, c.key);
    const ranked = rankCandidates(
      { id: c.key, title: c.title, description: c.description, startDate: at(c.assignedDay), dueDate: at(c.dueDay, 23, 59) },
      snap.candidates,
      // Bo trong so san pham dang cham (tu buoc 11 den buoc 16: ba trong so da luu + Ho so = 0)
      { idf: snap.idf, now: snap.now, groupOnTimeRate: snap.mu, weights: LEGACY_WEIGHTS_V1 }
    );
    const skills = today
      .map((p) => `${p.key}:${skillAt(data.people.find((q) => q.key === p.key)!, c.topic, days).toFixed(2)}`)
      .join(' ');
    console.log(`${c.key} "${c.title}" | chu de AN: ${TOPICS[c.topic]!.name}${c.ambiguous ? ' (MO HO)' : ''}`);
    console.log(`   ky nang AN: ${skills}  | dang giao cho: ${c.assigneeKey}`);
    for (const r of ranked.slice(0, 3)) console.log(`   ${describe(r)}`);
    const top = ranked[0]!;
    for (const e of top.evidence.slice(0, 2)) {
      console.log(`      bang chung: "${e.title}" giong ${e.sim.toFixed(2)}, ${e.outcome}`);
    }
  }

  // ---------- (2) Phat lai lich su (mac dinh: chuan hoa MINMAX, thanh phan thieu DROP) ----------
  console.log('\n===== PHAT LAI LICH SU (kiem tra nhanh, KHONG phai danh gia; mac dinh MINMAX / DROP) =====');
  const seeds = [DEFAULT_SIM.seed, 1, 2, 3, 4, 5, 6];
  const datasets = seeds.map((s) => generateSimulation({ ...DEFAULT_SIM, seed: s }));
  const rows: ReplayResult[] = datasets.map((d) => replay(d));
  const line = (name: string, f: (r: ReplayResult) => number, pct = false) => {
    const xs = rows.map(f);
    const k = pct ? 100 : 1;
    console.log(
      `  ${name.padEnd(46)} ${(mean(xs) * k).toFixed(pct ? 1 : 2).padStart(6)}${pct ? '%' : ' '}  (sd ${(sd(xs) * k).toFixed(pct ? 1 : 2)}; ${xs.map((x) => (x * k).toFixed(pct ? 0 : 2)).join(' ')})`
    );
  };
  console.log(`So the phat lai moi hat giong: ${rows.map((r) => r.n).join(', ')} (chi the giao tu ngay 60 tro di)`);
  line('top-1 trung dap an tot nhat - bo cham', (r) => r.hitScorer, true);
  line('top-1 trung dap an tot nhat - phan cong that', (r) => r.hitActual, true);
  line('top-1 trung dap an tot nhat - ngau nhien (ky vong)', (r) => r.hitRandom, true);
  line('do hoi tiec (ky nang) - bo cham', (r) => r.regretScorer);
  line('do hoi tiec (ky nang) - phan cong that', (r) => r.regretActual);
  line('do hoi tiec (ky nang) - ngau nhien (ky vong)', (r) => r.regretRandom);
  line('nguoi xep dau la nguoi CHUA CO LICH SU (NO_HISTORY)', (r) => r.topNoHistory, true);
  line('nguoi xep dau co do tin cay MONG (THIN)', (r) => r.topThin, true);
  line('so ung vien trung binh trong ho boi', (r) => r.poolSize);

  // ---------- (3) So sanh cach xep hang ----------
  console.log('\n===== SO SANH CACH XEP HANG (trung binh 7 hat giong, cung tap tinh huong) =====');
  console.log('  P(dung han) = xac suat dung han KY VONG cua nguoi duoc chon (mo hinh ket qua cua bo sinh, co xet tai).');
  const modes: [string, Normalization, MissingPolicy][] = [
    ['cong tho (NONE / DROP) - ban truoc chuan hoa', 'NONE', 'DROP'],
    ['MINMAX / DROP - MAC DINH (phuong an A)', 'MINMAX', 'DROP'],
    ['MINMAX / NEUTRAL', 'MINMAX', 'NEUTRAL'],
  ];
  const results = modes.map(([, normalize, missing]) => datasets.map((d) => replay(d, { normalize, missing })));
  const rowOf = (name: string, rs: ReplayResult[]) =>
    console.log(
      `  ${name.padEnd(46)} top-1 ${(mean(rs.map((r) => r.hitScorer)) * 100).toFixed(1).padStart(5)}%   hoi tiec ${mean(rs.map((r) => r.regretScorer)).toFixed(3)}   NO_HISTORY dau ${(mean(rs.map((r) => r.topNoHistory)) * 100).toFixed(1).padStart(4)}%   P(dung han) ${mean(rs.map((r) => r.pOnTimeScorer)).toFixed(3)}`
    );
  modes.forEach(([name], i) => rowOf(name, results[i]!));
  const base = results[1]!;
  const refRow = (name: string, hit: (r: ReplayResult) => number, regret: (r: ReplayResult) => number, p: (r: ReplayResult) => number) =>
    console.log(
      `  ${name.padEnd(46)} top-1 ${(mean(base.map(hit)) * 100).toFixed(1).padStart(5)}%   hoi tiec ${mean(base.map(regret)).toFixed(3)}   ${' '.repeat(23)}P(dung han) ${mean(base.map(p)).toFixed(3)}`
    );
  refRow('(tham chieu) phan cong that trong lich su', (r) => r.hitActual, (r) => r.regretActual, (r) => r.pOnTimeActual);
  refRow('(tham chieu) ngau nhien', (r) => r.hitRandom, (r) => r.regretRandom, (r) => r.pOnTimeRandom);
  console.log(`  (tham chieu) nguoi co KY NANG cao nhat                                                                 P(dung han) ${mean(base.map((r) => r.pOnTimeBest)).toFixed(3)}`);
  console.log(`  (tham chieu) TOI UU (max P dung han trong ho boi)                                                      P(dung han) ${mean(base.map((r) => r.pOnTimeOracle)).toFixed(3)}`);

  // ---------- (4) Tach thanh phan (cong tho: chan doan ban dau dan toi phuong an A) ----------
  console.log('\n===== TACH THANH PHAN, CONG THO (chan doan ban dau: tai sao mac dinh cu chi 26%) =====');
  const variants: [string, Weights | undefined][] = [
    ['mac dinh 0,45 / 0,30 / 0,25', undefined],
    ['chi kinh nghiem   1 / 0 / 0', { experience: 1, reliability: 0, availability: 0, declared: 0 }],
    ['chi tin cay       0 / 1 / 0', { experience: 0, reliability: 1, availability: 0, declared: 0 }],
    ['chi kha dung      0 / 0 / 1', { experience: 0, reliability: 0, availability: 1, declared: 0 }],
    ['kinh nghiem + tin cay 0,6 / 0,4 / 0', { experience: 0.6, reliability: 0.4, availability: 0, declared: 0 }],
  ];
  for (const [name, weights] of variants) {
    const rs = datasets.map((d) => replay(d, { weights, normalize: 'NONE' }));
    console.log(
      `  ${name.padEnd(40)} top-1 ${(mean(rs.map((r) => r.hitScorer)) * 100).toFixed(1).padStart(5)}%   hoi tiec ${mean(rs.map((r) => r.regretScorer)).toFixed(3)}   P(dung han) ${mean(rs.map((r) => r.pOnTimeScorer)).toFixed(3)}`
    );
  }

  // ---------- (5) Do phan tan truoc / sau chuan hoa ----------
  console.log('\n===== DO PHAN TAN GIUA CAC UNG VIEN CUA CUNG MOT THE (7 hat giong) =====');
  console.log('  Anh huong THUC TE len thu tu xep hang ~ trong so x do lech chuan cua gia tri DUNG DE CONG.');
  const names = ['experience', 'reliability', 'availability'] as const;
  const spreadRow = (label: string, sp: ReturnType<typeof componentSpread>, key: 'sd' | 'scaledSd') => {
    const influence = names.map((k) => LEGACY_WEIGHTS_V1[k] * sp[k][key]);
    const total = influence.reduce((a, b) => a + b, 0);
    console.log(
      `  ${label.padEnd(24)} do lech chuan ${names.map((k) => sp[k][key].toFixed(3)).join(' / ')}   anh huong thuc te ${influence.map((v) => ((v / total) * 100).toFixed(0).padStart(2) + '%').join(' / ')}`
    );
  };
  const before = componentSpread(datasets, { normalize: 'NONE' });
  const after = componentSpread(datasets);
  console.log('  (kinh nghiem / tin cay / kha dung; trong so danh nghia 45% / 30% / 25%)');
  spreadRow('cong tho (NONE)', before, 'sd');
  spreadRow('sau chuan hoa (MINMAX)', after, 'scaledSd');
  console.log('  thanh phan     trung binh   do lech chuan (tho)   khoang    tuong quan voi ky nang');
  names.forEach((k) => {
    const s = before[k];
    console.log(
      `  ${k.padEnd(13)} ${s.mean.toFixed(3).padStart(9)}   ${s.sd.toFixed(3).padStart(19)}   ${s.range.toFixed(3).padStart(6)}   ${s.corrWithSkill.toFixed(3).padStart(22)}`
    );
  });
}

main();
