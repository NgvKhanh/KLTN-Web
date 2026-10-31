// Kiem DO PHU cua bo mo phong v2 (RISK_MODULE.md §20.4, dieu kien de sang buoc 11). Chay trong backend/:
//   npx tsx src/scripts/riskCoverageV2.ts [--out=eval-risk-coverage-v2.md]
// CHI DOC CSDL dev. Voi tung thong ke cua bang §20.1: gia tri cua CSDL dev phai nam trong [nho nhat; lon nhat] cua 40 the gioi hoc
// v2 - kiem PHU, khong kiem KHOP. Thong ke nao khong phu -> ghi lai va HOI user, KHONG tu noi khoang tham so.

import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../config/prisma';
import { runDbBacktest } from './riskBacktestDb';
import { COVERAGE_STATS, TRAIN_SEEDS_V2, coverageCheck, coverageStats, generateRiskWorldV2, type CoverageStat } from './riskSimV2';
import { TRAIN_SEEDS, generateRiskWorld, summarizeWorld } from './riskSim';
import { computePriors, snapshotsOfWorld } from './riskSnapshots';

const LABEL: Readonly<Record<CoverageStat, string>> = {
  noAssignee: 'Tỉ lệ ảnh chụp chưa ai nhận',
  logDaysSinceActivity: 'TB ln(1 + số ngày không hoạt động)',
  logEvents7d: 'TB ln(1 + số sự kiện 7 ngày)',
  checklistShare: 'Tỉ lệ ảnh chụp có checklist',
  storyPointShare: 'Tỉ lệ ảnh chụp có story point',
};
/** Thong ke khong phu ma user da chap nhan la gioi han (27/10, §20.4) - nhom "tao trong app roi bo do". */
export const ACCEPTED_UNCOVERED: readonly CoverageStat[] = ['logDaysSinceActivity', 'logEvents7d'];
const vn = (x: number, d = 3) => x.toFixed(d).replace('.', ',');

export async function runCoverage() {
  const db = await runDbBacktest();
  const devStats = coverageStats(db.rows);
  const worlds = TRAIN_SEEDS_V2.map((s) => generateRiskWorldV2(s));
  const priors = computePriors(worlds);
  const perWorld = worlds.map((w) => coverageStats(snapshotsOfWorld(w.seed, w.cards, w.now, priors)));
  const v1Worlds = TRAIN_SEEDS.map((s) => generateRiskWorld(s));
  const v1Priors = computePriors(v1Worlds);
  const v1PerWorld = v1Worlds.map((w) => coverageStats(snapshotsOfWorld(w.seed, w.cards, w.now, v1Priors)));
  return {
    devStats,
    check: coverageCheck(perWorld, devStats),
    v1Check: coverageCheck(v1PerWorld, devStats),
    lateRates: worlds.map((w) => summarizeWorld(w).lateRate),
    worlds,
  };
}

export function renderCoverage(r: Awaited<ReturnType<typeof runCoverage>>): string {
  const L: string[] = [];
  const covered = r.check.filter((c) => c.covered).length;
  const uncovered = r.check.filter((c) => !c.covered).map((c) => c.stat);
  const accepted = uncovered.length > 0 && uncovered.every((k) => ACCEPTED_UNCOVERED.includes(k));
  const verdict =
    uncovered.length === 0 ? 'PHỦ ĐỦ 5/5' : accepted ? `phủ ${covered}/5 — user chấp nhận ngày 27/10 (§20.4)` : `phủ ${covered}/5 — phải hỏi user`;
  L.push('# Kiểm độ phủ của bộ mô phỏng v2 (bước 10)', '');
  L.push(`40 thế giới học v2 (${TRAIN_SEEDS_V2[0]}–${TRAIN_SEEDS_V2.at(-1)}) so với CSDL dev · kết luận: **${verdict}**`, '');
  L.push('| Thống kê | CSDL dev | v2: nhỏ nhất – lớn nhất | Phủ? | v1: nhỏ nhất – lớn nhất |', '|---|---|---|---|---|');
  for (const k of COVERAGE_STATS) {
    const c = r.check.find((x) => x.stat === k)!;
    const c1 = r.v1Check.find((x) => x.stat === k)!;
    L.push(`| ${LABEL[k]} | ${vn(c.dev)} | ${vn(c.min)} – ${vn(c.max)} | ${c.covered ? 'có' : '**không**'} | ${vn(c1.min)} – ${vn(c1.max)} ${c1.covered ? '' : '(không phủ)'} |`);
  }
  const lr = [...r.lateRates].sort((a, b) => a - b);
  L.push('', `Tỉ lệ trễ (thẻ đã xong có hạn) của 40 thế giới v2: thấp nhất ${vn(lr[0]!)}, trung vị ${vn(lr[20]!)}, cao nhất ${vn(lr.at(-1)!)}.`, '');
  L.push('Kiểm **phủ**, không kiểm **khớp**: chỉ cần giá trị của CSDL dev nằm trong dải các thế giới học sinh ra (§20.4).', '');
  if (accepted) {
    L.push(
      '**Giới hạn đã chấp nhận**: hai thống kê hoạt động không phủ gần như chỉ do nhóm dữ liệu dev "tạo trong app" — bảng tạo ra ' +
        '(nhiều bảng do AI sinh) rồi bỏ dở. Đó không phải hành vi của một nhóm đang làm việc nên không nới thêm khoảng tham số; ' +
        'kết luận của v2 không áp dụng cho kiểu "bảng bỏ dở" này.',
      ''
    );
  }
  return L.join('\n');
}

if (require.main === module) {
  const out = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] ?? 'eval-risk-coverage-v2.md';
  runCoverage()
    .then((r) => {
      fs.writeFileSync(path.resolve(out), `${renderCoverage(r)}\n`, 'utf8');
      console.log(renderCoverage(r));
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
