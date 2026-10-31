// Script danh gia chatbot (CHATBOT_MODULE.md §14). CHAY TAY, khong nam trong bo test:
//
//   npx tsx src/scripts/evaluateChat.ts --arm=B0 --split=dev
//   npx tsx src/scripts/evaluateChat.ts --arm=all --split=dev --runs=3 --delay=4000 --out=eval-chat-dev.md
//   (buoc 8 - tap test chay DUNG MOT LAN sau khi chot prompt + bo luat tren dev)
//   npx tsx src/scripts/evaluateChat.ts --arm=all --split=test --runs=3 --delay=4000 --out=eval-chat-result.md
//
//   --arm=B0|B1|B2|all      (hoac danh sach B0,B2) - B0 khong can khoa API
//   --split=dev|test|all    mac dinh dev
//   --runs=N                so lan chay nhanh co LLM (1..10, mac dinh 1)
//   --delay=MS              nghi giua 2 lan goi API that (mac dinh 4000 - goi free bat dau 429 quanh 15 luot/phut)
//   --items=A01,C04         chi chay cac cau nay
//   --part=all|legacy|new   legacy = 98 cau cua vong 1 (hoi quy), new = cau danh muc vong 2 (§18.6), mac dinh all
//   --out=FILE              ghi bao cao markdown ra FILE va du lieu tho ra FILE.json
//   --cache-dir=DIR         thu muc bo dem (mac dinh .chat-eval-cache)
//
// B1 va B2 dung CHUNG mot phan hoi LLM cho moi (cau, lan chay): chenh lech giua hai nhanh chi do luat gop.
// Phan hoi THO duoc dem (evalCache: ca BAD_JSON/EMPTY; KHONG dem loi ha tang) -> chay lai / doi cach cham
// khong ton them request. Gap 429 thi DUNG NGAY, in bao cao phan da chay, thoat ma 2.
// KHONG ghi DB, KHONG import prisma. Cau hinh LLM = cau hinh cua san pham (defaultChatLlm: timeout 8 giay).

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env';
import { callLlm, type LlmResult, type ResponseFormatMode } from '../modules/ai/ai.llm';
import type { FollowUpContext } from '../modules/chat/chat.followup';
import { parseLlmIntent } from '../modules/chat/chat.intent';
import { buildIntentMessages, buildIntentSystemPrompt, chatLlmAvailable, defaultChatLlm, INTENT_FORMAT } from '../modules/chat/chat.llm';
import { parseByRules } from '../modules/chat/chat.rules';
import { ARMS, runArm, scoreItem, type ArmId, type LlmParse, type ScoredRun } from './chatEvalCore';
import { CHAT_EVAL_ITEMS, CHAT_EVAL_LEGACY_ITEMS, EVAL_ROSTER, evalEnvFor, type ChatEvalItem } from './chatEvalDataset';
import { buildChatReport, type ChatReportMeta, type LlmCallObs } from './chatEvalReport';
import { cacheKey, cacheRead, cacheWrite } from './evalCache';

interface Args {
  arms: ArmId[];
  split: 'dev' | 'test' | 'all';
  runs: number;
  delayMs: number;
  items: string[] | null;
  part: 'all' | 'legacy' | 'new';
  out: string | null;
  cacheDir: string;
}

function fail(message: string): never {
  console.error(`Loi tham so: ${message}`);
  process.exit(1);
}

export function parseArgs(argv: readonly string[]): Args {
  const opts = new Map<string, string>();
  for (const a of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (!m) fail(`khong hieu "${a}" (dung --ten=gia-tri)`);
    opts.set(m[1]!, m[2]!);
  }
  const known = new Set(['arm', 'split', 'runs', 'delay', 'items', 'part', 'out', 'cache-dir']);
  for (const k of opts.keys()) if (!known.has(k)) fail(`tham so la "--${k}"`);

  const armOpt = opts.get('arm') ?? 'B0';
  const arms: ArmId[] = [];
  for (const name of armOpt === 'all' ? ARMS : armOpt.split(',')) {
    const arm = ARMS.find((a) => a === name.trim());
    if (arm === undefined) fail(`--arm phai la ${ARMS.join('|')}|all, nhan "${name}"`);
    if (!arms.includes(arm)) arms.push(arm);
  }
  const split = opts.get('split') ?? 'dev';
  if (split !== 'dev' && split !== 'test' && split !== 'all') fail('--split phai la dev|test|all');
  const runs = Number(opts.get('runs') ?? '1');
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) fail('--runs phai la so nguyen 1..10');
  const delayMs = Number(opts.get('delay') ?? '4000');
  if (!Number.isFinite(delayMs) || delayMs < 0) fail('--delay phai >= 0');
  const itemOpt = opts.get('items');
  const items = itemOpt === undefined ? null : itemOpt.split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (items !== null) {
    const ids = new Set(CHAT_EVAL_ITEMS.map((i) => i.id));
    for (const id of items) if (!ids.has(id)) fail(`khong co cau "${id}"`);
  }
  const part = opts.get('part') ?? 'all';
  if (part !== 'all' && part !== 'legacy' && part !== 'new') fail('--part phai la all|legacy|new');
  return { arms, split, runs, delayMs, items, part, out: opts.get('out') ?? null, cacheDir: opts.get('cache-dir') ?? '.chat-eval-cache' };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Phien ban bo luat = dau van tay ma nguon cac tep quyet dinh ket qua hieu cau (ghi vao bao cao, §14.5). */
function rulesVersion(): string {
  const dir = path.resolve(__dirname, '../modules/chat');
  const files = [
    'chat.intent.ts',
    'chat.members.ts',
    'chat.entities.ts',
    'chat.rules.ts',
    'chat.followup.ts',
    'chat.catalog.resolve.ts',
    'chat.llm.ts',
  ];
  return sha(files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n')).join('\n'));
}

function prevOf(item: ChatEvalItem): FollowUpContext | null {
  const p = item.prev;
  return p === null ? null : { intent: p.intent, period: p.period, focus: p.focus, memberUserId: p.member };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const legacyIds = new Set(CHAT_EVAL_LEGACY_ITEMS.map((i) => i.id));
  const items = CHAT_EVAL_ITEMS.filter(
    (i) =>
      (args.split === 'all' || i.split === args.split) &&
      (args.items === null || args.items.includes(i.id)) &&
      (args.part === 'all' || (args.part === 'legacy') === legacyIds.has(i.id))
  );
  const needLlm = args.arms.some((a) => a !== 'B0');
  const cfg = defaultChatLlm().cfg; // cung cau hinh san pham: env.ai + timeout 8 giay
  if (needLlm && !chatLlmAvailable(cfg)) {
    console.error('Nhanh B1/B2 can du AI_BASE_URL, AI_API_KEY, AI_MODEL trong backend/.env. Nhanh B0 khong can.');
    process.exit(1);
  }
  if (args.split !== 'dev') {
    console.error('LUU Y (§14.5): tap test chi chay DUNG MOT LAN, sau khi da chot prompt + bo luat tren tap dev.');
  }

  const byArm = new Map<ArmId, ScoredRun[]>(args.arms.map((a) => [a, []]));
  const llmObs: LlmCallObs[] = [];
  const formatModes = new Map<string, ResponseFormatMode>();
  let apiCalls = 0;
  let cacheHits = 0;
  let lastApiEnd = 0;
  let aborted: string | null = null;

  const getLlm = async (item: ChatEvalItem, run: number): Promise<LlmResult> => {
    const messages = buildIntentMessages(item.question, prevOf(item));
    const key = cacheKey('chat-intent', cfg.baseUrl, cfg.model, run, messages);
    const cached = cacheRead(args.cacheDir, key);
    if (cached !== null) {
      cacheHits += 1;
      return cached;
    }
    const wait = lastApiEnd + args.delayMs - Date.now();
    if (lastApiEnd !== 0 && wait > 0) await sleep(wait);
    const res = await callLlm(messages, cfg, { ...INTENT_FORMAT, startMode: formatModes.get(INTENT_FORMAT.name) });
    lastApiEnd = Date.now();
    apiCalls += 1;
    if (res.ok) formatModes.set(INTENT_FORMAT.name, res.formatMode);
    console.error(`${item.id} lan ${run}: API ${res.ok ? 'ok' : `LOI ${res.reason} ${res.status ?? ''} ${res.detail.slice(0, 120)}`} ${res.latencyMs}ms`);
    cacheWrite(args.cacheDir, key, { arm: 'chat-intent', sampleId: item.id, run, baseUrl: cfg.baseUrl, model: cfg.model }, res);
    return res;
  };

  outer: for (const item of items) {
    const prev = prevOf(item);
    // pham vi + danh muc ten cua cau: chi bo luat va buoc nhan dien o server thay; KHONG vao thong diep gui LLM
    const evalEnv = evalEnvFor(item);
    const rules = parseByRules(item.question, EVAL_ROSTER, evalEnv.catalog);
    if (byArm.has('B0')) {
      const pred = runArm('B0', rules, null, prev, EVAL_ROSTER, evalEnv);
      byArm.get('B0')!.push({ itemId: item.id, run: 1, gold: item.gold, pred, score: scoreItem(item.gold, pred) });
    }
    if (!needLlm) continue;
    for (let run = 1; run <= args.runs; run += 1) {
      const before = cacheHits;
      const res = await getLlm(item, run);
      if (!res.ok && res.status === 429) {
        aborted = `gặp HTTP 429 (hết hạn mức) ở câu ${item.id}, lần ${run}; các ô còn lại chưa chạy. Chạy lại lệnh cũ để tiếp tục (phần đã chạy nằm trong bộ đệm).`;
        break outer;
      }
      let llm: LlmParse;
      if (res.ok) {
        const parsed = parseLlmIntent(res.raw);
        llm = parsed === null ? { ok: false, reason: 'INVALID_SHAPE' } : { ok: true, parsed };
      } else {
        llm = { ok: false, reason: res.reason };
      }
      llmObs.push({
        itemId: item.id,
        run,
        ok: llm.ok,
        reason: llm.ok ? null : llm.reason,
        formatMode: res.formatMode,
        latencyMs: res.latencyMs,
        promptTokens: res.ok ? res.promptTokens : null,
        completionTokens: res.ok ? res.completionTokens : null,
        fromCache: cacheHits > before,
      });
      for (const arm of args.arms) {
        if (arm === 'B0') continue;
        const pred = runArm(arm, rules, llm, prev, EVAL_ROSTER, evalEnv);
        byArm.get(arm)!.push({ itemId: item.id, run, gold: item.gold, pred, score: scoreItem(item.gold, pred) });
      }
    }
  }

  // Dung giua chung: chi bao cao cac cau DA co du ket qua o moi nhanh
  const done = aborted === null ? items : items.filter((i) => args.arms.every((a) => byArm.get(a)!.some((r) => r.itemId === i.id)));
  const doneIds = new Set(done.map((i) => i.id));
  for (const [arm, runs] of byArm) byArm.set(arm, runs.filter((r) => doneIds.has(r.itemId)));

  const meta: ChatReportMeta = {
    date: new Date().toISOString().slice(0, 10),
    split: args.split,
    runs: needLlm ? args.runs : 1,
    arms: args.arms,
    provider: needLlm ? env.ai.providerLabel : '',
    model: needLlm ? cfg.model : '',
    datasetVersion: sha(JSON.stringify({ roster: EVAL_ROSTER, items: CHAT_EVAL_ITEMS })),
    promptVersion: sha(buildIntentSystemPrompt()),
    rulesVersion: rulesVersion(),
    apiCalls,
    cacheHits,
    aborted,
  };
  const report = buildChatReport(meta, byArm, done, llmObs.filter((o) => doneIds.has(o.itemId)), legacyIds);
  console.log(report);
  if (args.out !== null) {
    fs.writeFileSync(args.out, report, 'utf8');
    fs.writeFileSync(`${args.out}.json`, JSON.stringify({ meta, runs: Object.fromEntries(byArm), llmObs }, null, 2), 'utf8');
    console.error(`Da ghi ${args.out} va ${args.out}.json`);
  }
  if (aborted !== null) process.exit(2);
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error('Loi khong mong doi:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
