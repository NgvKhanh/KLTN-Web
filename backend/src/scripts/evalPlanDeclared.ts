// Script danh gia lai LOP 2 khi co thanh phan Ho so (buoc 19, ASSIGN_MODULE.md §17.10 / §17.12). CHAY TAY, khong nam trong bo test:
//
//   npx tsx src/scripts/evalPlanDeclared.ts --out=eval-plan-declared-result.md
//   --seeds=N  (2..20, mac dinh 20: 3001..3000+N) - N < 20 chi de chay thu, khong dung de trich dan
//
// Khong them lenh npm (package.json dang co dong do cua phien khac). Khong ghi DB, khong mang. Tat dinh: cung tham so -> cung so.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { datasetFingerprint } from './evalAssignReport';
import { prepare } from './evalDeclaredRun';
import { buildPlanDeclaredReport, planDeclaredExperiment } from './evalPlanDeclaredRun';
import { PLAN_EVAL_SEEDS } from './evalPlanRun';
import { generateDeclaredProfiles } from './simDeclared';

function fail(message: string): never {
  console.error(`Loi tham so: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): { seeds: number; out: string | null } {
  const opts = new Map<string, string>();
  for (const a of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (!m) fail(`khong hieu "${a}" (dung --ten=gia-tri)`);
    opts.set(m[1]!, m[2]!);
  }
  for (const k of opts.keys()) if (!['seeds', 'out'].includes(k)) fail(`tham so la "--${k}"`);
  const seeds = Number(opts.get('seeds') ?? String(PLAN_EVAL_SEEDS.length));
  if (!Number.isInteger(seeds) || seeds < 2 || seeds > PLAN_EVAL_SEEDS.length) fail(`--seeds phai la so nguyen 2..${PLAN_EVAL_SEEDS.length}`);
  return { seeds, out: opts.get('out') ?? null };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const seeds = PLAN_EVAL_SEEDS.slice(0, args.seeds);
  const t0 = Date.now();
  const datasets = seeds.map((seed) => prepare(seed));
  const profilesSha256 = createHash('sha256')
    .update(datasets.map((ds) => JSON.stringify([...generateDeclaredProfiles(ds.data)])).join('\n'))
    .digest('hex');
  console.error(`Da sinh ${datasets.length} bo du lieu + ho so sau ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const results = planDeclaredExperiment(datasets);
  console.error(`Da chay xong sau ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const meta = {
    date: new Date().toISOString().slice(0, 10),
    seeds,
    datasetSha256: datasetFingerprint(datasets.map((d) => d.data)).combined,
    profilesSha256,
  };
  const report = buildPlanDeclaredReport(meta, results);
  console.log(report);
  if (args.out !== null) {
    fs.writeFileSync(args.out, report, 'utf8');
    fs.writeFileSync(`${args.out}.json`, JSON.stringify({ meta, results }), 'utf8');
    console.error(`Da ghi ${args.out} va ${args.out}.json`);
  }
}

main();
