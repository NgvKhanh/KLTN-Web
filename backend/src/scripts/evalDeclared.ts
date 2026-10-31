// Script danh gia thanh phan "Ho so" (buoc 15, ASSIGN_MODULE.md §17.10). CHAY TAY, khong nam trong bo test:
//
//   npx tsx src/scripts/evalDeclared.ts --phase=dev --out=eval-declared-dev.md       (chon d tren 9801-9820)
//   npx tsx src/scripts/evalDeclared.ts --phase=confirm --out=eval-declared-result.md (MOT lan tren 4001-4020, d = DEFAULT_DECLARED_WEIGHT)
//   --seeds=N  (2..20) chi de chay thu, khong dung de trich dan
//
// Pha confirm doc d TU HANG SO CUA SAN PHAM (DEFAULT_DECLARED_WEIGHT): muon doi d thi phai sua + commit hang so truoc - khong co cach
// chinh d sau khi thay so. Khong ghi DB, khong mang. Tat dinh.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { DEFAULT_DECLARED_WEIGHT } from '../modules/assign/assign.score';
import { datasetFingerprint } from './evalAssignReport';
import {
  CURVES,
  DECLARED_DEV_SEEDS,
  DECLARED_EVAL_SEEDS,
  WORLDS,
  chooseD,
  curve,
  dSweep,
  liarExperiment,
  mainExperiment,
  missingExperiment,
  prepare,
  type DeclaredDataset,
} from './evalDeclaredRun';
import { buildConfirmReport, buildDevReport, type DeclaredMeta } from './evalDeclaredReport';
import { generateDeclaredProfiles } from './simDeclared';

function fail(message: string): never {
  console.error(`Loi tham so: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const opts = new Map<string, string>();
  for (const a of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (!m) fail(`khong hieu "${a}" (dung --ten=gia-tri)`);
    opts.set(m[1]!, m[2]!);
  }
  for (const k of opts.keys()) if (!['phase', 'seeds', 'out'].includes(k)) fail(`tham so la "--${k}"`);
  const phase = opts.get('phase');
  if (phase !== 'dev' && phase !== 'confirm') fail('--phase phai la dev | confirm');
  const seeds = Number(opts.get('seeds') ?? '20');
  if (!Number.isInteger(seeds) || seeds < 2 || seeds > 20) fail('--seeds phai la so nguyen 2..20');
  return { phase, seeds, out: opts.get('out') ?? null };
}

const log = (line: string) => console.error(line);

function metaOf(datasets: readonly DeclaredDataset[]): DeclaredMeta {
  const profiles = createHash('sha256');
  for (const ds of datasets) profiles.update(JSON.stringify([...generateDeclaredProfiles(ds.data)]));
  return {
    date: new Date().toISOString().slice(0, 10),
    seeds: datasets.map((d) => d.seed),
    datasetSha256: datasetFingerprint(datasets.map((d) => d.data)).combined,
    profileSha256: profiles.digest('hex'),
  };
}

function write(out: string | null, report: string, raw: unknown): void {
  console.log(report);
  if (out === null) return;
  fs.writeFileSync(out, report, 'utf8');
  fs.writeFileSync(`${out}.json`, JSON.stringify(raw), 'utf8');
  log(`Da ghi ${out} va ${out}.json`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;
  const seeds = (args.phase === 'dev' ? DECLARED_DEV_SEEDS : DECLARED_EVAL_SEEDS).slice(0, args.seeds);
  const datasets = seeds.map((s) => prepare(s));
  const meta = metaOf(datasets);
  log(`Da sinh ${datasets.length} bo du lieu + ho so (${elapsed()})`);

  if (args.phase === 'dev') {
    const rows = dSweep(datasets);
    const choice = chooseD(rows);
    log(`Da quet d (${elapsed()}): chon ${choice.d}`);
    write(args.out, buildDevReport(meta, rows, choice), { meta, rows, choice });
    return;
  }

  const d = DEFAULT_DECLARED_WEIGHT;
  const main = mainExperiment(datasets, d);
  log(`Da chay so sanh chinh (${elapsed()})`);
  const curves = [];
  for (const knob of Object.keys(CURVES) as (keyof typeof CURVES)[]) {
    for (const world of WORLDS) {
      curves.push({ knob, world, points: curve(datasets, d, knob, world, main.summaries[world]['full-3'].map((s) => s.pOnTimeAssigned)) });
      log(`Da ve duong cong ${knob} / ${world} (${elapsed()})`);
    }
  }
  const liar = WORLDS.map((w) => liarExperiment(datasets, d, w));
  log(`Da do nguoi khai qua (${elapsed()})`);
  const missing = missingExperiment(datasets, d);
  log(`Da do DROP / NEUTRAL / ZERO (${elapsed()})`);
  write(args.out, buildConfirmReport({ meta, main, curves, liar, missing }), { meta, main, curves, liar, missing });
}

main();
