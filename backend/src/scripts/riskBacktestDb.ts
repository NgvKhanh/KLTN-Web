// Doi chieu mo hinh canh bao tre han tren CSDL DEV (RISK_MODULE.md §7.4) - CHI MO TA, khong dung de chon tham so.
// Chay trong backend/: `npx tsx src/scripts/riskBacktestDb.ts [--out=eval-risk-db.md]`. CHI DOC CSDL (khong ghi gi).
//
// Dung lai DUNG duong cua module: readWorkspaceHistories (risk.repo) -> anh chup qua khu (riskSnapshots, mode replay) -> cham
// bang tep mo hinh. Moi khong gian cham rieng (lich su chi trong cung khong gian). Nguon du lieu doan theo email thanh vien:
// co thanh vien @talkshow.test = seed Talk show (chu la tai khoan that), chu @sim.local = bo mo phong cua module phan cong, con lai
// = du lieu tao trong app (tay + AI tao bang).
// Kem bang chan doan: AUC cua TUNG dac trung tren mo phong (hat giong dev) va tren CSDL dev - de thay vi sao ket qua khac nhau.
// `--sim=v2` (buoc 12, §20.4): cham bang logreg-v2, kem so sanh voi logreg-v1 + luat co dinh va tieu chi chuyen (§20.5)
// -> eval-risk-db-v2.md. KHONG con la phep thu sach (so lieu dev da duoc nhin khi thiet ke v2).
// `--model=v3` (buoc 17, §21): cham bang logreg-v3 (4 yeu to), so voi logreg-v2 + luat co dinh, tieu chi §21.5 -> eval-risk-db-v3.md.

import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../config/prisma';
import { readWorkspaceHistories } from '../modules/risk/risk.repo';
import { FEATURE_NAMES, STATUS_INPUTS, inputValue, type InputName } from '../modules/risk/risk.features';
import { auc } from './riskMetrics';
import { buildEvalSet, buildPredictors, buildTrainSet, metricsOf, scoreRows, type ArmName } from './riskEval';
import { ARM_LABEL, loadModelFile } from './evalRisk';
import { HORIZONS, hashRows, snapshotsOfWorld, type SnapshotRow } from './riskSnapshots';
import { seedsOf } from './riskSimV2';
import { MODEL_SPECS, modelArg, type ModelKey } from './trainRisk';

const ARMS_SHOWN: ArmName[] = ['logreg', 'rules', 'timeProgress', 'timeStatus', 'timeOnly', 'baseRate'];
const vn = (x: number | null, d = 3) => (x === null ? '—' : x.toFixed(d).replace('.', ','));
const pct = (x: number | null) => (x === null ? '—' : `${vn(100 * x, 1)}%`);

function sourceOf(ownerEmail: string, memberEmails: readonly string[]): string {
  if (memberEmails.some((e) => e.endsWith('@talkshow.test'))) return 'Seed Talk show';
  if (ownerEmail.endsWith('@sim.local')) return 'Mô phỏng phân công (@sim.local)';
  return 'Tạo trong app (tay + AI tạo bảng)';
}

/** AUC cua mot dac trung dung mot minh (gia tri lon hon = du doan tre hon); < 0,5 nghia la di nguoc. */
function singleAuc(rows: readonly SnapshotRow[], name: InputName): number | null {
  const xs = rows.map((x) => inputValue(x.features, name));
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return auc(rows.map((x, i) => ({ p: hi > lo ? (xs[i]! - lo) / (hi - lo) : 0.5, y: x.y })));
}

export async function runDbBacktest(now: Date = new Date(), key: ModelKey = 'v1') {
  const sim = MODEL_SPECS[key].sim;
  const model = loadModelFile(key);
  const train = buildTrainSet(model.training.seeds, sim);
  if (hashRows(train.rows) !== model.training.sha256) throw new Error('tap hoc khong khop tep mo hinh - chay lai npm run risk:train');
  const predictors = buildPredictors(model, train.rows, model.train);

  const workspaces = await prisma.workspace.findMany({
    select: { id: true, owner: { select: { email: true } }, members: { select: { user: { select: { email: true } } } } },
    orderBy: { id: 'asc' },
  });
  const rows: (SnapshotRow & { source: string })[] = [];
  let cards = 0;
  let legacyTicks = 0;
  for (const ws of workspaces) {
    const histories = await readWorkspaceHistories(ws.id);
    if (histories.length === 0) continue;
    cards += histories.length;
    legacyTicks += histories.reduce((a, h) => a + h.checklist.filter((i) => i.isDone && i.completedAt === null).length, 0);
    const source = sourceOf(ws.owner.email, ws.members.map((m) => m.user.email));
    for (const r of snapshotsOfWorld(0, histories, now, model.priors)) rows.push({ ...r, source });
  }
  // Doi chung cho bang chan doan: 10 the gioi DEV cua bo mo phong (khong dung hat giong xac nhan)
  const simRows = buildEvalSet(seedsOf(sim).dev.slice(0, 10), model.priors, sim).flatMap((w) => w.rows);
  return { key, sim, model, rows, simRows, cards, legacyTicks, workspaces: workspaces.length, predictors, now };
}

type DbBacktest = Awaited<ReturnType<typeof runDbBacktest>>;

/** AUC mot nhanh tren cac anh chup (null khi khong du hai lop). */
const aucOf = (r: DbBacktest, arm: ArmName, rows: readonly SnapshotRow[] = r.rows) =>
  rows.length > 0 ? metricsOf(scoreRows(rows, r.predictors[arm])).auc : null;

/** Tieu chi chuyen bo quet (§20.5 cho v2, §21.5 cho v3), phan tren CSDL dev: AUC mo hinh >= AUC luat co dinh (cung anh chup). */
export function dbCriterion(r: DbBacktest): { model: number | null; rules: number | null; pass: boolean } {
  const model = aucOf(r, 'logreg');
  const rules = aucOf(r, 'rules');
  return { model, rules, pass: model !== null && rules !== null && model >= rules };
}

/** `v1` = lan chay voi mo hinh lien truoc tren cung CSDL (v1 cho r = v2, v2 cho r = v3): bang so sanh + tieu chi chuyen. */
export function renderDbReport(r: DbBacktest, v1?: DbBacktest): string {
  const L: string[] = [];
  const v2 = r.sim === 'v2';
  const rule = ({ v1: '§7.4', v2: '§20.5', v3: '§21.5', v4: '§22.5' } as const)[r.key];
  const pos = r.rows.filter((x) => x.y === 1).length;
  L.push(
    r.key === 'v1'
      ? '# Đối chiếu mô hình cảnh báo nguy cơ trễ hạn trên CSDL dev (chỉ mô tả)'
      : `# Đối chiếu mô hình ${r.key} trên CSDL dev (bước ${({ v1: 8, v2: 12, v3: 17, v4: 22 } as const)[r.key]}, chỉ mô tả)`,
    ''
  );
  L.push(
    `Ngày chạy ${r.now.toISOString().slice(0, 10)} · ${r.workspaces} không gian, ${r.cards} thẻ · ${r.rows.length} ảnh chụp quá khứ ` +
      `(${pct(r.rows.length > 0 ? pos / r.rows.length : null)} trễ) · mô hình \`${r.model.version}\` (học trên bộ mô phỏng vòng đời${v2 ? ' v2' : ''}, KHÔNG học lại ở đây)`,
    ''
  );
  if (v2) {
    L.push(
      '**Không còn là phép thử sạch**: số liệu CSDL dev đã được nhìn khi thiết kế bộ mô phỏng v2 (kiểm độ phủ, §20.4). ' +
        `Bảng này chỉ dùng cho tiêu chí chuyển ${rule}, **không** dùng để tuyên bố "chạy tốt trên dữ liệu thật".`,
      ''
    );
  }
  L.push('## 1. Các nhánh (gộp mọi ảnh chụp)', '');
  L.push('| Nhánh | AUC | Brier | ECE | Chính xác @51 | Phủ @51 |', '|---|---|---|---|---|---|');
  for (const arm of ARMS_SHOWN) {
    const m = r.rows.length > 0 ? metricsOf(scoreRows(r.rows, r.predictors[arm])) : null;
    L.push(`| ${ARM_LABEL[arm]} | ${vn(m?.auc ?? null)} | ${vn(m?.brier ?? null)} | ${vn(m?.ece ?? null)} | ${pct(m?.precision51 ?? null)} | ${pct(m?.recall51 ?? null)} |`);
  }
  if (v1) {
    const c = dbCriterion(r);
    L.push('', `## 1b. So với mô hình ${v1.key} và tiêu chí chuyển (${rule})`, '');
    L.push(
      `| Nhóm | Ảnh chụp | AUC \`${r.model.version}\` | AUC \`${v1.model.version}\` | AUC luật cố định |`,
      '|---|---|---|---|---|'
    );
    const row = (label: string, keep: (x: { source: string; horizon: number }) => boolean) => {
      const a = r.rows.filter(keep);
      const b = v1.rows.filter(keep);
      if (a.length === 0) return;
      L.push(`| ${label} | ${a.length} | ${vn(aucOf(r, 'logreg', a))} | ${vn(aucOf(v1, 'logreg', b))} | ${vn(aucOf(r, 'rules', a))} |`);
    };
    row('Tất cả', () => true);
    for (const s of [...new Set(r.rows.map((x) => x.source))].sort()) row(s, (x) => x.source === s);
    L.push(
      '',
      `Tiêu chí ${rule} (phần CSDL dev): AUC \`${r.model.version}\` ${vn(c.model)} ${c.pass ? '≥' : '<'} AUC luật cố định ${vn(c.rules)} → **${c.pass ? 'ĐẠT' : 'KHÔNG ĐẠT'}**. ` +
        `Mỗi mô hình chấm trên ảnh chụp dựng bằng priors của chính nó (như khi chạy thật); luật cố định chấm trên cùng ảnh chụp với mô hình ${r.key}.`,
      ''
    );
  }
  L.push('', '## 2. Theo nguồn dữ liệu và theo mốc (mô hình chính)', '');
  L.push('| Nhóm | Ảnh chụp | Tỉ lệ trễ | AUC |', '|---|---|---|---|');
  const group = (label: string, rows: SnapshotRow[]) => {
    if (rows.length === 0) return;
    const m = metricsOf(scoreRows(rows, r.predictors.logreg));
    L.push(`| ${label} | ${rows.length} | ${pct(m.positives / m.rows)} | ${vn(m.auc)} |`);
  };
  for (const s of [...new Set(r.rows.map((x) => x.source))].sort()) group(s, r.rows.filter((x) => x.source === s));
  for (const h of HORIZONS) group(`Mốc ${h} ngày trước hạn`, r.rows.filter((x) => x.horizon === h));
  L.push('', '## 3. Vì sao khác bộ mô phỏng: từng đặc trưng dùng một mình', '');
  L.push('| Đặc trưng | Hệ số mô hình | AUC trên mô phỏng (hạt giống dev) | AUC trên CSDL dev | TB mô phỏng | TB CSDL dev |', '|---|---|---|---|---|---|');
  const mean = (rows: readonly SnapshotRow[], n: InputName) => rows.reduce((a, x) => a + inputValue(x.features, n), 0) / Math.max(1, rows.length);
  // He so lay THEO TEN dau vao cua tep (tep gon v4 khong theo thu tu FEATURE_NAMES); dau vao tep khong co -> "—"
  const weightOf = (n: InputName) => {
    const j = r.model.features.indexOf(n);
    return j < 0 ? null : r.model.weights[j]!;
  };
  const shown: InputName[] = [...FEATURE_NAMES, ...STATUS_INPUTS.filter((n) => r.model.features.includes(n))];
  shown.forEach((n) => {
    L.push(`| \`${n}\` | ${vn(weightOf(n))} | ${vn(singleAuc(r.simRows, n))} | ${vn(r.rows.length > 0 ? singleAuc(r.rows, n) : null)} | ${vn(mean(r.simRows, n), 2)} | ${vn(mean(r.rows, n), 2)} |`);
  });
  const checklistShare = (rows: readonly SnapshotRow[]) => rows.filter((x) => x.features.detail.progressSource === 'CHECKLIST').length / Math.max(1, rows.length);
  L.push(
    '',
    `AUC < 0,5 = đặc trưng đi ngược chiều trên dữ liệu đó. Ảnh chụp có checklist: mô phỏng ${pct(checklistShare(r.simRows))}, CSDL dev ${pct(checklistShare(r.rows))}. ` +
      (v2
        ? 'Cột "mô phỏng" ở đây là 10 thế giới dev của bộ mô phỏng **v2** (7101–7110).'
        : 'Đặc trưng mạnh nhất của mô hình (`paceRatio`, dựa trên thời lượng làm thẻ trong lịch sử) không còn tác dụng trên dữ liệu dev, trong khi các đặc trưng bị ràng buộc dấu giữ ở 0 trên mô phỏng (chưa ai nhận, thẻ tương tự, số ngày không hoạt động) lại mạnh trên dữ liệu dev — khoảng cách giữa mô phỏng và dữ liệu này.'),
    ''
  );
  L.push('## 4. Giới hạn (đọc trước khi trích số)', '');
  L.push(
    `- Phần lớn dữ liệu do seed sinh ra (cột "Nhóm"), không phải nhóm thật làm việc; số liệu ở đây chỉ để **mô tả**, không thay được đánh giá chính thức trên bộ mô phỏng (\`${r.key === 'v1' ? 'eval-risk-result.md' : `eval-risk-result-${r.key}.md`}\`).`,
    `- ${r.legacyTicks} mục checklist đã tick từ trước khi có cột thời điểm tick: ảnh chụp quá khứ bỏ các mục này khỏi tử lẫn mẫu (§5.1).`,
    '- Người bị gỡ khỏi thẻ, lịch sử đổi ngày bắt đầu và đổi story point không được ghi nên không dựng lại được; dùng giá trị hiện tại.',
    '- Bộ mô phỏng của module phân công (@sim.local) không có nhật ký trạng thái chi tiết như dữ liệu thật — tiến độ lúc t chủ yếu suy từ trạng thái hiện tại.',
    ''
  );
  return L.join('\n');
}

if (require.main === module) {
  const key = modelArg();
  const out = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] ?? (key === 'v1' ? 'eval-risk-db.md' : `eval-risk-db-${key}.md`);
  const now = new Date();
  (async () => {
    const r = await runDbBacktest(now, key);
    const previous = MODEL_SPECS[key].previous;
    const v1 = previous ? await runDbBacktest(now, previous) : undefined;
    return { r, v1 };
  })()
    .then(({ r, v1 }) => {
      fs.writeFileSync(path.resolve(out), `${renderDbReport(r, v1)}\n`, 'utf8');
      console.log(`da ghi ${out}: ${r.rows.length} anh chup tu ${r.cards} the`);
      if (v1) console.log(`tieu chi chuyen, phan CSDL dev: ${JSON.stringify(dbCriterion(r))}`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
