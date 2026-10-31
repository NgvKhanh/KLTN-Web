// Script danh gia module AI (buoc 10, AI_MODULE.md §13). CHAY TAY, khong nam trong bo test:
//
//   npm run eval:ai -- --arm=rule
//   npm run eval:ai -- --arm=all --runs=1 --delay=2000 --out=eval-result.md
//
//   --arm=rule|hybrid|llm-only|llm-only-v2|all   nhanh can chay (mac dinh rule; rule khong can khoa);
//                                    all = rule+hybrid+llm-only; co the liet ke: --arm=rule,hybrid,llm-only-v2
//   --runs=N                          so lan chay moi mau cho nhanh co LLM (mac dinh 1, toi da 10)
//   --delay=MS                        nghi giua 2 lan goi API that (mac dinh 2000) de tranh 429
//   --samples=S01,F02                 chi chay cac mau nay (mac dinh: ca 25)
//   --out=FILE                        ghi them bao cao markdown ra FILE va du lieu tho ra FILE.json
//   --cache-dir=DIR                   thu muc cache (mac dinh .ai-eval-cache)
//
// KHONG ghi DB, KHONG import prisma. Phan hoi THO cua LLM luu vao cache (xem evalCache.ts; ca loi noi dung
// BAD_JSON/EMPTY duoc cache de chay lai tai lap): chay lai (hoac doi cach cham diem) khong ton them request;
// doi model/prompt/lan chay thi khoa cache doi -> goi lai. Loi ha tang (429, 5xx, het gio...) khong cache.
// Gap 429 thi DUNG NGAY, giu nguyen tien do (da cache), in bao cao phan da chay va thoat ma 2.

import fs from 'node:fs';
import { env } from '../config/env';
import { callLlm, type LlmMessages, type LlmResult } from '../modules/ai/ai.llm';
import {
  analyzeSample,
  callJsonLlm,
  hybridMessages,
  llmOnlyMessages,
  runHybrid,
  runLlmOnly,
  runRule,
  type Arm,
} from './evalArms';
import { cacheKey, cacheRead, cacheWrite } from './evalCache';
import { DATASET, DATASET_TODAY, type DatasetSample } from './evalDataset';
import { scoreRun, type ModeRow } from './evalMetrics';
import { buildReport, type ReportMeta, type RunRow } from './evalReport';

interface Args {
  arms: Arm[];
  runs: number;
  delayMs: number;
  samples: string[] | null;
  out: string | null;
  cacheDir: string;
}

function fail(message: string): never {
  console.error(`Loi tham so: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const opts = new Map<string, string>();
  for (const a of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (!m) fail(`khong hieu "${a}" (dung --ten=gia-tri)`);
    opts.set(m[1]!, m[2]!);
  }
  const known = new Set(['arm', 'runs', 'delay', 'samples', 'out', 'cache-dir']);
  for (const k of opts.keys()) if (!known.has(k)) fail(`tham so la "--${k}"`);

  // "all" = ba nhanh goc; nhanh do nhay llm-only-v2 phai goi ten ro. Cho phep danh sach: --arm=rule,hybrid,llm-only-v2
  const armNames: readonly Arm[] = ['rule', 'hybrid', 'llm-only', 'llm-only-v2'];
  const armOpt = opts.get('arm') ?? 'rule';
  const arms: Arm[] = [];
  for (const name of armOpt === 'all' ? ['rule', 'hybrid', 'llm-only'] : armOpt.split(',')) {
    const arm = armNames.find((a) => a === name.trim());
    if (arm === undefined) fail(`--arm phai la ${armNames.join('|')}|all hoac danh sach cach nhau dau phay, nhan "${name}"`);
    if (!arms.includes(arm)) arms.push(arm);
  }
  const runs = Number(opts.get('runs') ?? '1');
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) fail('--runs phai la so nguyen 1..10');
  const delayMs = Number(opts.get('delay') ?? '2000');
  if (!Number.isFinite(delayMs) || delayMs < 0) fail('--delay phai >= 0');
  const sampleOpt = opts.get('samples');
  const samples = sampleOpt === undefined ? null : sampleOpt.split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (samples !== null) {
    const ids = new Set(DATASET.map((s) => s.id));
    for (const id of samples) if (!ids.has(id)) fail(`khong co mau "${id}"`);
  }
  return { arms, runs, delayMs, samples, out: opts.get('out') ?? null, cacheDir: opts.get('cache-dir') ?? '.ai-eval-cache' };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const samples: DatasetSample[] = DATASET.filter((s) => args.samples === null || args.samples.includes(s.id));
  const cfg = env.ai;
  const needLlm = args.arms.some((a) => a !== 'rule');
  if (needLlm && (!cfg.baseUrl || !cfg.apiKey || !cfg.model)) {
    console.error('Nhanh hybrid/llm-only can du AI_BASE_URL, AI_API_KEY, AI_MODEL trong backend/.env. Nhanh rule khong can.');
    process.exit(1);
  }

  const rows: RunRow[] = [];
  let apiCalls = 0;
  let cacheHits = 0;
  let lastApiEnd = 0;
  let aborted: string | null = null;

  const getLlm = async (arm: Arm, sample: DatasetSample, run: number, messages: LlmMessages): Promise<LlmResult> => {
    const key = cacheKey(arm, cfg.baseUrl, cfg.model, run, messages);
    const cached = cacheRead(args.cacheDir, key);
    if (cached !== null) {
      cacheHits += 1;
      console.error(`[${arm}] ${sample.id} lan ${run}: cache`);
      return cached;
    }
    const wait = lastApiEnd + args.delayMs - Date.now();
    if (lastApiEnd !== 0 && wait > 0) await sleep(wait);
    const res = arm === 'hybrid' ? await callLlm(messages, cfg) : await callJsonLlm(messages, cfg);
    lastApiEnd = Date.now();
    apiCalls += 1;
    console.error(
      `[${arm}] ${sample.id} lan ${run}: API ${res.ok ? 'ok' : `LOI ${res.reason} ${res.status ?? ''} ${res.detail.slice(0, 160)}`} ${res.latencyMs}ms`
    );
    cacheWrite(args.cacheDir, key, { arm, sampleId: sample.id, run, baseUrl: cfg.baseUrl, model: cfg.model }, res); // chi ghi khi dang cache (ok hoac loi noi dung)
    return res;
  };

  outer: for (const arm of args.arms) {
    for (const sample of samples) {
      const runs = arm === 'rule' ? 1 : args.runs;
      for (let run = 1; run <= runs; run += 1) {
        if (arm === 'rule') {
          rows.push({ arm, sampleId: sample.id, group: sample.group, run, score: scoreRun(sample, runRule(sample).cards), obs: null });
          continue;
        }
        const messages = arm === 'hybrid' ? hybridMessages(sample) : llmOnlyMessages(sample, arm === 'llm-only-v2' ? 'v2' : 'v1');
        const res = await getLlm(arm, sample, run, messages);
        if (!res.ok && res.status === 429) {
          aborted = `gặp HTTP 429 (hết hạn mức) ở nhánh ${arm}, mẫu ${sample.id}, lần ${run}; các ô còn lại chưa chạy. Chạy lại lệnh cũ để tiếp tục (phần đã chạy nằm trong cache).`;
          break outer;
        }
        const out = arm === 'hybrid' ? runHybrid(sample, res) : runLlmOnly(sample, res);
        rows.push({ arm, sampleId: sample.id, group: sample.group, run, score: scoreRun(sample, out.cards), obs: out.obs });
      }
    }
  }

  const modeRows: ModeRow[] = samples.map((s) => {
    const f = analyzeSample(s);
    return { id: s.id, group: s.group, goldMode: s.goldMode, structuredRatio: f.structuredRatio, contentLines: f.lines.length };
  });
  const meta: ReportMeta = {
    date: new Date().toISOString().slice(0, 10),
    today: DATASET_TODAY,
    provider: needLlm ? cfg.providerLabel : '',
    model: needLlm ? cfg.model : '',
    runs: args.runs,
    sampleCount: samples.length,
    apiCalls,
    cacheHits,
    aborted,
  };
  const report = buildReport(rows, meta, modeRows);
  console.log(report);
  if (args.out !== null) {
    fs.writeFileSync(args.out, report, 'utf8');
    fs.writeFileSync(`${args.out}.json`, JSON.stringify({ meta, rows }, null, 2), 'utf8');
    console.error(`Da ghi ${args.out} va ${args.out}.json`);
  }
  if (aborted !== null) process.exit(2);
}

main().catch((e: unknown) => {
  console.error('Loi khong mong doi:', e instanceof Error ? e.message : e);
  process.exit(1);
});
