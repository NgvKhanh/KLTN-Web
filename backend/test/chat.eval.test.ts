// Bo danh gia chatbot (CHATBOT_MODULE.md §14): bo du lieu nhat quan + dong bang, chi so tinh dung, va duong
// xu ly cua bo danh gia TRUNG voi dich vu that (handleMessage tren CSDL). Test nay KHONG do chat luong.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { foldText, normalizeText } from '../src/modules/ai/ai.rules';
import type { FollowUpContext } from '../src/modules/chat/chat.followup';
import { EMPTY_CATALOG } from '../src/modules/chat/chat.entities';
import { CATALOG_INTENTS, resolveSlots, type ParsedQuestion } from '../src/modules/chat/chat.intent';
import { LlmBudget, PROMPT_EXAMPLES } from '../src/modules/chat/chat.llm';
import { matchMember } from '../src/modules/chat/chat.members';
import { parseByRules } from '../src/modules/chat/chat.rules';
import { handleMessage, understandByRules } from '../src/modules/chat/chat.service';
import { ChatSessionStore } from '../src/modules/chat/chat.session';
import {
  armParse,
  confusionOf,
  INTENT_LABELS,
  fullMatchCI,
  labelOf,
  macroF1,
  outcomeKey,
  outcomeOf,
  pairedFull,
  perItemFull,
  runArm,
  scoreItem,
  summarizeArm,
  type GoldOutcome,
  type Outcome,
  type ScoredRun,
} from '../src/scripts/chatEvalCore';
import {
  CHAT_EVAL_ITEMS,
  CHAT_EVAL_LEGACY_ITEMS,
  EVAL_CATALOG,
  EVAL_ROSTER,
  EVAL_WS_CATALOG,
  evalEnvFor,
  type ChatEvalItem,
} from '../src/scripts/chatEvalDataset';
import type { EvalEnv } from '../src/scripts/chatEvalCore';
import { buildChatReport, describeOutcome, isPlain, type ChatReportMeta } from '../src/scripts/chatEvalReport';
import { parseArgs } from '../src/scripts/evaluateChat';
import { makeDirectUser } from './helpers';

const prevOf = (i: ChatEvalItem): FollowUpContext | null =>
  i.prev === null ? null : { intent: i.prev.intent, period: i.prev.period, focus: i.prev.focus, memberUserId: i.prev.member };
const P = (over: Partial<ParsedQuestion> = {}): ParsedQuestion => ({ intent: 'MY_TASKS', period: null, focus: null, member: null, ...over });
const fold = (s: string) => foldText(normalizeText(s).toLowerCase()).split(/\s+/).join(' ').trim();

describe('bo du lieu danh gia chatbot', () => {
  it('cau truc: 98 cau cu (A-H) + 66 cau danh muc (I-M) = 164 cau / 13 nhom, id duy nhat theo tien to nhom, dev = cau 1, 4, 7... cua moi nhom (59 dev / 105 test)', () => {
    expect(CHAT_EVAL_LEGACY_ITEMS).toHaveLength(98);
    expect(CHAT_EVAL_ITEMS).toHaveLength(164);
    expect(CHAT_EVAL_ITEMS.slice(0, 98)).toEqual(CHAT_EVAL_LEGACY_ITEMS);
    expect(new Set(CHAT_EVAL_ITEMS.map((i) => i.id)).size).toBe(164);
    const byGroup = (g: string) => CHAT_EVAL_ITEMS.filter((i) => i.group === g);
    const prefix: Record<string, string> = {
      MY_TASKS: 'A',
      MY_PRIORITIES: 'B',
      MEMBER_TASKS: 'C',
      TEAM_SUMMARY: 'D',
      TEAM_WORKLOAD: 'E',
      FOLLOW_UP: 'F',
      OUT_OF_SCOPE: 'G',
      INJECTION: 'H',
      MY_BOARDS: 'I',
      MY_WORKSPACES: 'J',
      MEMBER_LIST: 'K',
      CARD_COUNTS: 'L',
      NEAR_MISS: 'M',
    };
    expect(Object.keys(prefix).map((g) => byGroup(g).length)).toEqual([13, 11, 21, 13, 11, 14, 9, 6, 12, 10, 14, 16, 14]);
    for (const [g, p] of Object.entries(prefix)) {
      byGroup(g).forEach((item, i) => {
        expect(item.id).toBe(`${p}${String(i + 1).padStart(2, '0')}`);
        expect(item.split).toBe(i % 3 === 0 ? 'dev' : 'test');
      });
    }
    expect(CHAT_EVAL_ITEMS.filter((i) => i.split === 'dev')).toHaveLength(59);
    expect(CHAT_EVAL_LEGACY_ITEMS.filter((i) => i.split === 'dev')).toHaveLength(35);
    // truong `scope` chi co o cau vong 2; cau cu khong co (= pham vi WORKSPACE)
    expect(CHAT_EVAL_LEGACY_ITEMS.filter((i) => 'scope' in i)).toEqual([]);
    expect(CHAT_EVAL_ITEMS.slice(98).every((i) => i.scope === 'MY' || i.scope === 'WORKSPACE')).toBe(true);
    // moi nhom deu co o ca hai tap
    for (const g of Object.keys(prefix)) expect(new Set(byGroup(g).map((i) => i.split))).toEqual(new Set(['dev', 'test']));
  });

  it('danh sach nguoi: 12 nguoi, id duy nhat; co trung ten "Lan" va cac ten trung tu thuong (Tuấn, Mai, Nam, An, Bình, Minh, Thắng, Huy)', () => {
    expect(EVAL_ROSTER).toHaveLength(12);
    expect(new Set(EVAL_ROSTER.map((m) => m.userId)).size).toBe(12);
    expect(matchMember('Lan', EVAL_ROSTER)).toMatchObject({ kind: 'MANY' });
    for (const name of ['Tuấn', 'Mai', 'Nam', 'An', 'Bình', 'Minh', 'Thắng', 'Huy']) {
      expect(matchMember(name, EVAL_ROSTER), name).toMatchObject({ kind: 'ONE' });
    }
  });

  it('nhan vang hop le: truy van da o dang CHUAN (diem bat dong cua resolveSlots), nguoi / ung vien / ngu canh deu thuoc danh sach', () => {
    const ids = new Set(EVAL_ROSTER.map((m) => m.userId));
    const problems: string[] = [];
    for (const item of CHAT_EVAL_ITEMS) {
      const g = item.gold;
      if (g.kind === 'QUERY') {
        const r = resolveSlots({ intent: g.intent, period: g.period, focus: g.focus, memberText: null, memberUserId: g.member });
        if (r.period !== g.period || r.focus !== g.focus) problems.push(`${item.id}: khong o dang chuan (${r.period}/${r.focus})`);
        if ((g.intent === 'MEMBER_TASKS') !== (g.member !== null)) problems.push(`${item.id}: member chi co o MEMBER_TASKS`);
        if (g.member !== null && !ids.has(g.member)) problems.push(`${item.id}: member la`);
        if (g.ignored.some((s) => !['period', 'focus', 'member'].includes(s))) problems.push(`${item.id}: ignored la`);
      }
      if (g.kind === 'CLARIFY_MEMBER' && (g.candidates.length < 2 || g.candidates.some((c) => !ids.has(c)))) problems.push(`${item.id}: ung vien`);
      // nhan vang danh muc: id / ten cot phai co that trong danh muc cua pham vi cau do
      if (g.kind === 'CATALOG' || g.kind === 'CLARIFY_TARGET' || g.kind === 'TARGET_NOT_FOUND' || g.kind === 'ASK_WORKSPACE') {
        const cat = evalEnvFor(item).catalog;
        const entityIds = new Set([...cat.boards.map((b) => b.id), ...cat.workspaces.map((w) => w.id)]);
        if (!(CATALOG_INTENTS as readonly string[]).includes(g.intent)) problems.push(`${item.id}: y dinh danh muc la`);
        if (g.kind === 'CATALOG') {
          if (g.target !== null && !entityIds.has(g.target)) problems.push(`${item.id}: target khong co trong danh muc`);
          if (g.column !== null && !cat.columns.some((c) => c.name === g.column)) problems.push(`${item.id}: cot khong co trong danh muc`);
          if (g.column !== null && g.intent !== 'CARD_COUNTS') problems.push(`${item.id}: cot chi co o CARD_COUNTS`);
          if (g.target !== null && g.intent === 'MY_BOARDS' && !cat.workspaces.some((w) => w.id === g.target)) problems.push(`${item.id}: MY_BOARDS loc theo khong gian`);
        }
        if (g.kind === 'CLARIFY_TARGET' && (g.candidates.length < 2 || g.candidates.some((c) => !entityIds.has(c)))) problems.push(`${item.id}: ung vien bang`);
        if (g.kind === 'ASK_WORKSPACE' && (g.intent !== 'MEMBER_LIST' || item.scope !== 'MY')) problems.push(`${item.id}: ASK_WORKSPACE chi MEMBER_LIST o pham vi MY`);
        if (item.prev !== null) problems.push(`${item.id}: cau danh muc khong noi tiep`);
      }
      if (item.prev?.member && !ids.has(item.prev.member)) problems.push(`${item.id}: prev.member la`);
      if (item.question.trim() === '' || item.question.length > 500) problems.push(`${item.id}: do dai cau hoi`);
    }
    expect(problems).toEqual([]);
    // Nhom cau noi tiep deu co ngu canh truoc, tru dung 1 cau "noi tiep ma khong co ngu canh" -> UNSUPPORTED
    const follow = CHAT_EVAL_ITEMS.filter((i) => i.group === 'FOLLOW_UP');
    expect(follow.filter((i) => i.prev === null).map((i) => [i.id, i.gold.kind])).toEqual([['F12', 'UNSUPPORTED']]);
    expect(CHAT_EVAL_ITEMS.filter((i) => i.group !== 'FOLLOW_UP' && i.prev !== null)).toEqual([]);
    // Du 10 nhan y dinh o CA HAI tap (kiem macro-F1 10 nhan co nghia)
    expect(INTENT_LABELS).toHaveLength(10);
    for (const split of ['dev', 'test'] as const) {
      expect(new Set(CHAT_EVAL_ITEMS.filter((i) => i.split === split).map((i) => labelOf(i.gold)))).toEqual(new Set(INTENT_LABELS));
    }
    // moi loai ket qua danh muc (chon bang, khong tim thay, hoi khong gian) co it nhat mot cau o CA HAI tap
    for (const split of ['dev', 'test'] as const) {
      const kinds = new Set(CHAT_EVAL_ITEMS.filter((i) => i.split === split).map((i) => i.gold.kind));
      for (const k of ['CATALOG', 'CLARIFY_TARGET', 'TARGET_NOT_FOUND', 'QUERY', 'UNSUPPORTED', 'CLARIFY_MEMBER']) expect(kinds.has(k as never), `${split}: ${k}`).toBe(true);
    }
    // cau danh muc bao phu ca ba pham vi dung: MY (chinh) va WORKSPACE (nhom cau gan giong)
    expect(new Set(CHAT_EVAL_ITEMS.slice(98).map((i) => i.scope))).toEqual(new Set(['MY', 'WORKSPACE']));
  });

  it('khong cau nao trung vi du trong prompt (so khong dau, bo khoang trang thua) - tranh do tren chinh vi du da day LLM', () => {
    const examples = new Set(PROMPT_EXAMPLES.map((e) => fold(e.question)));
    expect(CHAT_EVAL_ITEMS.filter((i) => examples.has(fold(i.question))).map((i) => i.id)).toEqual([]);
  });

  it('DONG BANG: dau van tay sha256 cua danh sach nguoi + toan bo cau hoi / nhan vang / ngu canh / tap', () => {
    // Khi CO CHU Y sua (vd sau khi duyet nhan tren tap dev): xac nhan sua dung y roi chep gia tri moi vao day.
    // Sua SAU khi da chay tap test thi phai ghi ro trong bao cao / luan van (§14.5).
    const sha = (items: readonly ChatEvalItem[], extra: object = {}) =>
      createHash('sha256').update(JSON.stringify({ roster: EVAL_ROSTER, ...extra, items })).digest('hex');
    // 98 cau cua vong 1: KHONG DUOC DOI (gia tri nay da dong bang tu buoc 7 - §18.6)
    expect(sha(CHAT_EVAL_LEGACY_ITEMS)).toBe('966cbe7ae85a7f38ab563a6e7a55324f7f97ea094703a6531147ffc42b450570');
    // Vong 2: 164 cau + danh muc ten co dinh cua hai pham vi
    expect(sha(CHAT_EVAL_ITEMS, { catalog: EVAL_CATALOG, wsCatalog: EVAL_WS_CATALOG })).toBe('1f8ddd3ab0c4abab82923a12ad5854c1971185f1b9019a3b262aaa64615867ac');
  });

  it('danh muc ten cua bo danh gia: 3 khong gian / 11 bang / 34 cot, id duy nhat; co ten trung, ten bang trung ten khong gian, ten chung phan dau, cot lap lai; ws1 la tap con', () => {
    const c = EVAL_CATALOG;
    expect([c.workspaces.length, c.boards.length, c.columns.length]).toEqual([3, 11, 34]);
    for (const list of [c.workspaces, c.boards, c.columns]) expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    expect(c.boards.filter((b) => b.name === 'Website').map((b) => b.workspaceId).sort()).toEqual(['ws1', 'ws2']); // ten bang trung
    expect(c.workspaces.some((w) => w.name === 'Marketing') && c.boards.some((b) => b.name === 'Marketing')).toBe(true); // bang trung ten khong gian
    expect(c.columns.filter((x) => x.name === 'Đang làm').length).toBeGreaterThan(5); // cot lap lai
    const ws = EVAL_WS_CATALOG;
    expect(ws.workspaces.map((w) => w.id)).toEqual(['ws1']);
    expect(ws.boards.every((b) => b.workspaceId === 'ws1')).toBe(true);
    expect(ws.boards.map((b) => b.id).sort()).toEqual(c.boards.filter((b) => b.workspaceId === 'ws1').map((b) => b.id).sort());
    expect(ws.columns.every((x) => ws.boards.some((b) => b.id === x.boardId))).toBe(true);
    // cot cua ws1 trung id voi cot cua cung bang trong danh muc day du? (id cot chi can duy nhat trong tung danh muc)
    expect(evalEnvFor(CHAT_EVAL_LEGACY_ITEMS[0])).toEqual({ scope: expect.objectContaining({ kind: 'WORKSPACE' }), catalog: EVAL_WS_CATALOG });
    expect(evalEnvFor(CHAT_EVAL_ITEMS.find((i) => i.id === 'I01')!)).toEqual({ scope: expect.objectContaining({ kind: 'MY' }), catalog: EVAL_CATALOG });
  });

  it('HOI QUY: danh muc ten khong lam doi cach bo luat hieu 98 cau cu (giong het khi khong co danh muc), va ket qua B0 tren 98 cau cu van la 13 cau sai da biet', () => {
    const changed: string[] = [];
    for (const item of CHAT_EVAL_LEGACY_ITEMS) {
      const base = JSON.stringify(parseByRules(item.question, EVAL_ROSTER));
      for (const cat of [EMPTY_CATALOG, EVAL_WS_CATALOG, EVAL_CATALOG]) {
        if (JSON.stringify(parseByRules(item.question, EVAL_ROSTER, cat)) !== base) changed.push(item.id);
      }
    }
    expect(changed).toEqual([]);
    const wrong = CHAT_EVAL_LEGACY_ITEMS.filter((i) => {
      const env = evalEnvFor(i);
      const pred = runArm('B0', parseByRules(i.question, EVAL_ROSTER, env.catalog), null, prevOf(i), EVAL_ROSTER, env);
      return !scoreItem(i.gold, pred).full;
    }).map((i) => i.id);
    // vong 1: dev C16, F13, H01; test B08, C02, C03, C06, C09, C15, D05, D09, F05, H05 (CHATBOT_MODULE.md §14.6)
    expect(wrong.sort()).toEqual(['B08', 'C02', 'C03', 'C06', 'C09', 'C15', 'C16', 'D05', 'D09', 'F05', 'F13', 'H01', 'H05']);
  });
});

describe('loi cham diem (ham thuan)', () => {
  const roster = EVAL_ROSTER;

  it('outcomeOf: truy van / chua ho tro / hoi "ai?" / hoi lai trung ten / khong tim thay / cau noi tiep giu nguoi', () => {
    expect(outcomeOf(P({ focus: 'OVERDUE' }), null, roster)).toEqual({ kind: 'QUERY', intent: 'MY_TASKS', period: null, focus: 'OVERDUE', member: null, ignored: [] });
    expect(outcomeOf(P({ intent: 'UNSUPPORTED' }), null, roster)).toEqual({ kind: 'UNSUPPORTED' });
    expect(outcomeOf(P({ intent: 'NONE', period: 'NEXT_WEEK' }), null, roster)).toEqual({ kind: 'UNSUPPORTED' });
    expect(outcomeOf(P({ intent: 'MEMBER_TASKS' }), null, roster)).toEqual({ kind: 'ASK_WHO' });
    expect(outcomeOf(P({ intent: 'MEMBER_TASKS', member: 'Lan' }), null, roster)).toEqual({ kind: 'CLARIFY_MEMBER', candidates: ['r01', 'r02'] });
    expect(outcomeOf(P({ intent: 'MEMBER_TASKS', member: 'Hưng' }), null, roster)).toEqual({ kind: 'MEMBER_NOT_FOUND' });
    expect(outcomeOf(P({ intent: 'MEMBER_TASKS', member: 'Trần Lan', focus: 'DONE', period: 'NEXT_WEEK' }), null, roster)).toEqual({
      kind: 'QUERY',
      intent: 'MEMBER_TASKS',
      period: 'THIS_WEEK',
      focus: 'DONE',
      member: 'r02',
      ignored: ['period'],
    });
    const prev: FollowUpContext = { intent: 'MEMBER_TASKS', period: null, focus: 'OPEN', memberUserId: 'r03' };
    expect(outcomeOf(P({ intent: 'NONE', focus: 'OVERDUE' }), prev, roster)).toMatchObject({ kind: 'QUERY', member: 'r03', focus: 'OVERDUE' });
    // nguoi da chon khong con trong danh sach -> khong tim thay
    expect(outcomeOf(P({ intent: 'NONE', focus: 'OVERDUE' }), { ...prev, memberUserId: 'da-roi-nhom' }, roster)).toEqual({ kind: 'MEMBER_NOT_FOUND' });
    // ten nguoi o y dinh khong phai MEMBER_TASKS -> bo qua 'member'
    expect(outcomeOf(P({ intent: 'TEAM_SUMMARY', member: 'Lan' }), null, roster)).toMatchObject({ kind: 'QUERY', member: null, ignored: ['member'] });
  });

  it('outcomeOf danh muc: xac dinh / hoi lai chon bang / khong tim thay / hoi khong gian nao, theo danh muc + pham vi cua cau', () => {
    const my: EvalEnv = { scope: { kind: 'MY', workspace: null, board: null }, catalog: EVAL_CATALOG };
    const ws: EvalEnv = { scope: { kind: 'WORKSPACE', workspace: { id: 'ws1', name: 'Marketing' }, board: null }, catalog: EVAL_WS_CATALOG };
    const C = (intent: ParsedQuestion['intent'], target?: string, column?: string): ParsedQuestion => ({
      ...P({ intent }),
      ...(target === undefined ? {} : { target }),
      ...(column === undefined ? {} : { column }),
    });
    const rows: Array<[string, ParsedQuestion, EvalEnv, GoldOutcome]> = [
      ['bang', C('CARD_COUNTS', 'Sprint 12'), my, { kind: 'CATALOG', intent: 'CARD_COUNTS', target: 'b05', column: null }],
      ['bang + cot', C('CARD_COUNTS', 'Sprint 12', 'đang làm'), my, { kind: 'CATALOG', intent: 'CARD_COUNTS', target: 'b05', column: 'Đang làm' }],
      ['khong gian', C('MEMBER_LIST', 'Kỹ thuật'), my, { kind: 'CATALOG', intent: 'MEMBER_LIST', target: 'ws2', column: null }],
      ['MY_BOARDS loc khong gian', C('MY_BOARDS', 'Marketing'), my, { kind: 'CATALOG', intent: 'MY_BOARDS', target: 'ws1', column: null }],
      ['khong ten', C('MY_WORKSPACES'), my, { kind: 'CATALOG', intent: 'MY_WORKSPACES', target: null, column: null }],
      ['trung ten bang', C('CARD_COUNTS', 'Website'), my, { kind: 'CLARIFY_TARGET', intent: 'CARD_COUNTS', candidates: ['b04', 'b10'] }],
      ['bang + khong gian trung ten', C('MEMBER_LIST', 'Marketing'), my, { kind: 'CLARIFY_TARGET', intent: 'MEMBER_LIST', candidates: ['b11', 'ws1'] }],
      ['khong tim thay bang', C('CARD_COUNTS', 'Dự án Xyz'), my, { kind: 'TARGET_NOT_FOUND', intent: 'CARD_COUNTS', what: 'BOARD_OR_WORKSPACE' }],
      ['khong tim thay khong gian (MY_BOARDS)', C('MY_BOARDS', 'Sprint 12'), my, { kind: 'TARGET_NOT_FOUND', intent: 'MY_BOARDS', what: 'WORKSPACE' }],
      ['khong tim thay cot', C('CARD_COUNTS', undefined, 'Kiểm duyệt'), my, { kind: 'TARGET_NOT_FOUND', intent: 'CARD_COUNTS', what: 'COLUMN' }],
      ['thanh vien khong ten o MY -> hoi khong gian nao', C('MEMBER_LIST'), my, { kind: 'ASK_WORKSPACE', intent: 'MEMBER_LIST' }],
      ['thanh vien khong ten o WORKSPACE -> chinh khong gian', C('MEMBER_LIST'), ws, { kind: 'CATALOG', intent: 'MEMBER_LIST', target: 'ws1', column: null }],
      ['o WORKSPACE chi thay bang cua ws1', C('CARD_COUNTS', 'Sprint 12'), ws, { kind: 'TARGET_NOT_FOUND', intent: 'CARD_COUNTS', what: 'BOARD_OR_WORKSPACE' }],
      ['o WORKSPACE "Website" chi con mot bang', C('CARD_COUNTS', 'Website'), ws, { kind: 'CATALOG', intent: 'CARD_COUNTS', target: 'b10', column: null }],
    ];
    const wrong = rows.map(([name, parsed, env, want]) => ({ name, got: outcomeOf(parsed, null, roster, env), want })).filter((r) => JSON.stringify(r.got) !== JSON.stringify(r.want));
    expect(wrong).toEqual([]);
    // pham vi ca nhan: cau ve nhom / nguoi khac -> hoi khong gian truoc (nhu dich vu); chi mot khong gian thi dung luon
    for (const intent of ['TEAM_SUMMARY', 'TEAM_WORKLOAD', 'MEMBER_TASKS'] as const) {
      expect(outcomeOf(P({ intent, member: intent === 'MEMBER_TASKS' ? 'Lan' : null }), null, roster, my)).toEqual({ kind: 'ASK_WORKSPACE', intent });
    }
    const oneSpace: EvalEnv = { ...my, catalog: { ...EVAL_CATALOG, workspaces: [EVAL_CATALOG.workspaces[0]] } };
    expect(outcomeOf(P({ intent: 'TEAM_SUMMARY' }), null, roster, oneSpace)).toMatchObject({ kind: 'QUERY', intent: 'TEAM_SUMMARY', period: 'THIS_WEEK' });
    // ... con cau ve viec ca nhan / uu tien / chua ho tro khong bi anh huong
    expect(outcomeOf(P({ intent: 'MY_PRIORITIES' }), null, roster, my)).toMatchObject({ kind: 'QUERY', intent: 'MY_PRIORITIES' });
    expect(outcomeOf(P({ intent: 'UNSUPPORTED' }), null, roster, my)).toEqual({ kind: 'UNSUPPORTED' });
    // cau danh muc khong ke thua ngu canh; mot khong gian duy nhat -> MEMBER_LIST dung luon khong gian do
    const prev: FollowUpContext = { intent: 'MEMBER_TASKS', period: null, focus: 'OPEN', memberUserId: 'r03' };
    expect(outcomeOf(C('MY_BOARDS'), prev, roster, my)).toEqual({ kind: 'CATALOG', intent: 'MY_BOARDS', target: null, column: null });
    const single: EvalEnv = { ...my, catalog: { ...EVAL_CATALOG, workspaces: [EVAL_CATALOG.workspaces[0]] } };
    expect(outcomeOf(C('MEMBER_LIST'), null, roster, single)).toEqual({ kind: 'CATALOG', intent: 'MEMBER_LIST', target: 'ws1', column: null });
    // mac dinh (khong truyen moi truong): pham vi WORKSPACE, khong co danh muc -> ten nao cung khong tim thay
    expect(outcomeOf(C('CARD_COUNTS', 'Sprint 12'), null, roster)).toEqual({ kind: 'TARGET_NOT_FOUND', intent: 'CARD_COUNTS', what: 'BOARD_OR_WORKSPACE' });
  });

  it('scoreItem danh muc: y dinh, ten (khong xet y dinh), hoi lai, khong tim thay, khoa "khop hoan toan"', () => {
    const gold: GoldOutcome = { kind: 'CATALOG', intent: 'CARD_COUNTS', target: 'b05', column: 'Đang làm' };
    expect(scoreItem(gold, { ...gold })).toEqual({ intent: true, period: null, focus: null, member: null, full: true, ignored: null, clarify: null, target: true });
    // ten cot khong phan biet hoa thuong
    expect(scoreItem(gold, { ...gold, column: 'ĐANG LÀM'.toLowerCase() })).toMatchObject({ target: true, full: true });
    expect(scoreItem(gold, { ...gold, target: 'b06' })).toMatchObject({ intent: true, target: false, full: false });
    expect(scoreItem(gold, { ...gold, column: null })).toMatchObject({ target: false, full: false });
    // sai y dinh nhung dung ten: target dung, full sai
    expect(scoreItem(gold, { kind: 'CATALOG', intent: 'MEMBER_LIST', target: 'b05', column: 'Đang làm' })).toMatchObject({ intent: false, target: true, full: false });
    expect(scoreItem(gold, { kind: 'QUERY', intent: 'MY_TASKS', period: null, focus: 'OPEN', member: null, ignored: [] })).toMatchObject({ intent: false, target: false, full: false });
    expect(scoreItem(gold, { kind: 'LLM_FAILED', reason: 'X' })).toMatchObject({ intent: false, target: false, full: false });

    const clarify: GoldOutcome = { kind: 'CLARIFY_TARGET', intent: 'CARD_COUNTS', candidates: ['b04', 'b10'] };
    expect(scoreItem(clarify, { kind: 'CLARIFY_TARGET', intent: 'CARD_COUNTS', candidates: ['b10', 'b04'] })).toMatchObject({ intent: true, clarify: true, target: true, full: true });
    expect(scoreItem(clarify, { kind: 'CATALOG', intent: 'CARD_COUNTS', target: 'b04', column: null })).toMatchObject({ intent: true, clarify: false, target: false, full: false });
    expect(scoreItem(clarify, { kind: 'CLARIFY_TARGET', intent: 'CARD_COUNTS', candidates: ['b04', 'b05'] })).toMatchObject({ clarify: false, target: false });
    const nf: GoldOutcome = { kind: 'TARGET_NOT_FOUND', intent: 'CARD_COUNTS', what: 'COLUMN' };
    expect(scoreItem(nf, { ...nf })).toMatchObject({ clarify: null, target: true, full: true });
    expect(scoreItem(nf, { ...nf, what: 'BOARD_OR_WORKSPACE' })).toMatchObject({ intent: true, target: false, full: false });
    const ask: GoldOutcome = { kind: 'ASK_WORKSPACE', intent: 'MEMBER_LIST' };
    expect(scoreItem(ask, { ...ask })).toMatchObject({ intent: true, clarify: true, target: true, full: true });
    expect(scoreItem(ask, { kind: 'CLARIFY_MEMBER', candidates: ['r01', 'r02'] })).toMatchObject({ intent: false, clarify: false, target: false });
    // cau cu: khong co nhan vang danh muc thi target = null (khong lam loang mau so)
    expect(scoreItem({ kind: 'UNSUPPORTED' }, { kind: 'UNSUPPORTED' }).target).toBeNull();
    // hoi lai chon bang KHONG phai MEMBER_TASKS: nhan la chinh y dinh danh muc
    expect(labelOf({ kind: 'CLARIFY_TARGET', intent: 'MEMBER_LIST', candidates: ['b01', 'b02'] })).toBe('MEMBER_LIST');
    expect(labelOf(ask)).toBe('MEMBER_LIST');
    expect(labelOf(nf)).toBe('CARD_COUNTS');
    expect(outcomeKey(gold)).not.toBe(outcomeKey({ ...gold, column: null }));
  });

  it('armParse / runArm: B0 = luat; B1 = LLM, LLM loi -> LLM_FAILED; B2 = gop, LLM loi -> luat', () => {
    const rules = P({ intent: 'MEMBER_TASKS', period: 'NEXT_WEEK', member: 'lan' });
    const llmOk = { ok: true as const, parsed: P({ intent: 'MEMBER_TASKS', period: 'THIS_WEEK', focus: 'OPEN', member: 'Lan ơi' }) };
    const llmBad = { ok: false as const, reason: 'TIMEOUT' };
    expect(armParse('B0', rules, null, roster)).toBe(rules);
    expect(armParse('B1', rules, llmOk, roster)).toBe(llmOk.parsed);
    expect(armParse('B1', rules, llmBad, roster)).toBeNull();
    expect(armParse('B2', rules, llmOk, roster)).toEqual({ intent: 'MEMBER_TASKS', period: 'NEXT_WEEK', focus: 'OPEN', member: 'lan' });
    expect(armParse('B2', rules, llmBad, roster)).toBe(rules);
    expect(() => armParse('B1', rules, null, roster)).toThrow();
    expect(runArm('B1', rules, llmBad, null, roster)).toEqual({ kind: 'LLM_FAILED', reason: 'TIMEOUT' });
    expect(runArm('B2', rules, llmBad, null, roster)).toEqual({ kind: 'CLARIFY_MEMBER', candidates: ['r01', 'r02'] });
  });

  it('scoreItem: tung truong + khop hoan toan + tham so bo qua + hoi lai', () => {
    const gold: GoldOutcome = { kind: 'QUERY', intent: 'MEMBER_TASKS', period: 'THIS_WEEK', focus: 'DONE', member: 'r03', ignored: [] };
    const same = scoreItem(gold, { ...gold });
    expect(same).toEqual({ intent: true, period: true, focus: true, member: true, full: true, ignored: true, clarify: null, target: null });
    expect(scoreItem(gold, { ...gold, ignored: ['period'] })).toMatchObject({ full: true, ignored: false });
    expect(scoreItem(gold, { ...gold, period: 'LAST_WEEK' })).toMatchObject({ intent: true, period: false, focus: true, member: true, full: false, ignored: null });
    expect(scoreItem(gold, { ...gold, member: 'r04' })).toMatchObject({ member: false, full: false });
    expect(scoreItem(gold, { kind: 'MEMBER_NOT_FOUND' })).toMatchObject({ intent: true, period: false, focus: false, member: false, full: false });
    expect(scoreItem(gold, { kind: 'LLM_FAILED', reason: 'X' })).toMatchObject({ intent: false, period: false, member: false, full: false });
    const clarify: GoldOutcome = { kind: 'CLARIFY_MEMBER', candidates: ['r01', 'r02'] };
    expect(scoreItem(clarify, { kind: 'CLARIFY_MEMBER', candidates: ['r02', 'r01'] })).toEqual({
      intent: true,
      period: null,
      focus: null,
      member: true,
      full: true,
      ignored: null,
      clarify: true,
      target: null,
    });
    expect(scoreItem(clarify, { ...gold })).toMatchObject({ intent: true, member: false, full: false, clarify: false });
    expect(scoreItem({ kind: 'UNSUPPORTED' }, { kind: 'UNSUPPORTED' })).toEqual({ intent: true, period: null, focus: null, member: null, full: true, ignored: null, clarify: null, target: null });
    expect(scoreItem({ kind: 'ASK_WHO' }, { kind: 'MEMBER_NOT_FOUND' })).toMatchObject({ intent: true, member: false, full: false, clarify: false });
    expect(outcomeKey({ kind: 'QUERY', intent: 'MY_TASKS', period: null, focus: 'OPEN', member: null, ignored: ['period'] })).toBe(
      outcomeKey({ kind: 'QUERY', intent: 'MY_TASKS', period: null, focus: 'OPEN', member: null, ignored: [] })
    );
  });

  it('macro-F1 + ma tran nham tinh tay; LLM_FAILED giam recall, khong cong precision', () => {
    const q = (intent: 'MY_TASKS' | 'TEAM_SUMMARY'): Outcome => ({ kind: 'QUERY', intent, period: null, focus: 'OPEN', member: null, ignored: [] });
    const runs: ScoredRun[] = [
      ['MY_TASKS', q('MY_TASKS')],
      ['MY_TASKS', q('MY_TASKS')],
      ['MY_TASKS', q('TEAM_SUMMARY')],
      ['MY_TASKS', { kind: 'LLM_FAILED', reason: 'TIMEOUT' }],
      ['TEAM_SUMMARY', q('TEAM_SUMMARY')],
    ].map(([g, pred], i) => {
      const gold = q(g as 'MY_TASKS' | 'TEAM_SUMMARY') as GoldOutcome;
      return { itemId: `I${i}`, run: 1, gold, pred: pred as Outcome, score: scoreItem(gold, pred as Outcome) };
    });
    const conf = confusionOf(runs);
    expect(conf.MY_TASKS).toMatchObject({ MY_TASKS: 2, TEAM_SUMMARY: 1, LLM_FAILED: 1 });
    expect(conf.TEAM_SUMMARY).toMatchObject({ TEAM_SUMMARY: 1, MY_TASKS: 0 });
    const f = macroF1(conf);
    // MY_TASKS: P = 2/2, R = 2/4 -> F1 = 2/3; TEAM_SUMMARY: P = 1/2, R = 1/1 -> F1 = 2/3; 8 nhan con lai khong co nhan vang
    expect(f.perLabel.MY_TASKS).toBeCloseTo(2 / 3, 10);
    expect(f.perLabel.TEAM_SUMMARY).toBeCloseTo(2 / 3, 10);
    expect(f.perLabel.UNSUPPORTED).toBeNull();
    expect(f.macro).toBeCloseTo(2 / 3, 10);
    const s = summarizeArm(runs);
    expect([s.intent.hits, s.intent.n, s.full.hits, s.llmFailed]).toEqual([3, 5, 3, 1]);
    // mau so chi gom cac o AP DUNG: khong cau nao ve mot nguoi / hoi lai; "tham so bo qua" chi xet 3 cau khop hoan toan
    expect([s.period.n, s.member.n, s.clarify.n, s.ignored.n, s.target.n]).toEqual([5, 0, 0, 3, 0]);
    expect([s.member.rate, s.clarify.rate, s.target.rate]).toEqual([null, null, null]);
  });

  it('diem theo cau = trung binh qua cac lan chay; KTC bootstrap tat dinh; so sanh cap dung dau', () => {
    const gold: GoldOutcome = { kind: 'UNSUPPORTED' };
    const good: Outcome = { kind: 'UNSUPPORTED' };
    const bad: Outcome = { kind: 'ASK_WHO' };
    const mk = (pattern: Outcome[][]): ScoredRun[] =>
      pattern.flatMap((preds, i) => preds.map((pred, run) => ({ itemId: `I${i}`, run: run + 1, gold, pred, score: scoreItem(gold, pred) })));
    const a = mk([[good, good, bad], [good, good, good], [bad, bad, bad], [good, bad, good]]);
    const b = mk([[bad], [good], [bad], [bad]]);
    const ids = ['I0', 'I1', 'I2', 'I3'];
    expect(perItemFull(a, ids)).toEqual([2 / 3, 1, 0, 2 / 3]);
    expect(perItemFull(b, ids)).toEqual([0, 1, 0, 0]);
    expect(() => perItemFull(a, [...ids, 'I9'])).toThrow();
    const ci = fullMatchCI(a, ids)!;
    expect(ci.mean).toBeCloseTo(7 / 12, 10);
    expect(ci.lo).toBeLessThanOrEqual(ci.mean);
    expect(ci.hi).toBeGreaterThanOrEqual(ci.mean);
    expect(fullMatchCI(a, ids)).toEqual(ci); // cung hat giong -> cung khoang
    const d = pairedFull(a, b, ids)!;
    expect(d.mean).toBeCloseTo(7 / 12 - 1 / 4, 10);
    expect([d.positive, d.negative, d.ties]).toEqual([2, 0, 2]);
    expect(fullMatchCI(a, ['I0'])).toBeNull();
  });
});

describe('bao cao + tham so dong lenh', () => {
  it('bao cao: bang tong quan, so sanh cap, ma tran nham, theo nhom / loai kho, lop LLM, danh sach cau sai', () => {
    const items = CHAT_EVAL_ITEMS.filter((i) => ['A01', 'C04', 'G01'].includes(i.id));
    const b0: ScoredRun[] = items.map((i) => {
      const pred = runArm('B0', parseByRules(i.question, EVAL_ROSTER), null, prevOf(i), EVAL_ROSTER);
      return { itemId: i.id, run: 1, gold: i.gold, pred, score: scoreItem(i.gold, pred) };
    });
    const b1: ScoredRun[] = items.map((i) => {
      const pred: Outcome = { kind: 'LLM_FAILED', reason: 'TIMEOUT' };
      return { itemId: i.id, run: 1, gold: i.gold, pred, score: scoreItem(i.gold, pred) };
    });
    const meta: ChatReportMeta = {
      date: '2026-09-29',
      split: 'dev',
      runs: 1,
      arms: ['B0', 'B1'],
      provider: 'nha-cung-cap',
      model: 'model-gia',
      datasetVersion: 'd',
      promptVersion: 'p',
      rulesVersion: 'r',
      apiCalls: 3,
      cacheHits: 0,
      aborted: null,
    };
    const obs = items.map((i) => ({ itemId: i.id, run: 1, ok: false, reason: 'TIMEOUT', formatMode: 'json_schema', latencyMs: 8000, promptTokens: null, completionTokens: null, fromCache: false }));
    const md = buildChatReport(meta, new Map([['B0', b0], ['B1', b1]]), items, obs);
    expect(md).not.toContain('Câu cũ (hồi quy)'); // khong co legacyIds -> khong co bang tach bo cau
    for (const part of [
      '## Tổng quan theo nhánh',
      '| B0 | 100,0% (3/3)',
      '| B1 | 0,0% (0/3)',
      '## So sánh cặp (cùng câu hỏi)',
      '| B1 − B0 | -100,0 điểm %',
      '### Ma trận nhầm — B1',
      '## Khớp hoàn toàn theo nhóm câu hỏi',
      '## Khớp hoàn toàn theo loại khó',
      '| Lỗi theo loại | TIMEOUT 3 |',
      '## Câu sai — B0 (0)',
      '## Câu sai — B1 (3)',
      '| C04 | 1 | Lan đang làm gì? | hỏi lại: r01, r02 | LLM lỗi (TIMEOUT) |',
    ]) {
      expect(md, part).toContain(part);
    }
    expect(describeOutcome({ kind: 'QUERY', intent: 'MY_TASKS', period: null, focus: 'OPEN', member: null, ignored: ['period'] })).toBe('MY_TASKS · OPEN · – · – (bỏ qua period)');
    expect(describeOutcome({ kind: 'CATALOG', intent: 'CARD_COUNTS', target: 'b05', column: 'Đang làm' })).toBe('CARD_COUNTS · b05 · Đang làm');
    expect(describeOutcome({ kind: 'CATALOG', intent: 'MY_BOARDS', target: null, column: null })).toBe('MY_BOARDS · – · –');
    expect(describeOutcome({ kind: 'CLARIFY_TARGET', intent: 'MEMBER_LIST', candidates: ['b04', 'b10'] })).toBe('MEMBER_LIST · hỏi lại bảng/không gian: b04, b10');
    expect(describeOutcome({ kind: 'TARGET_NOT_FOUND', intent: 'CARD_COUNTS', what: 'COLUMN' })).toBe('CARD_COUNTS · không tìm thấy (COLUMN)');
    expect(describeOutcome({ kind: 'ASK_WORKSPACE', intent: 'MEMBER_LIST' })).toBe('MEMBER_LIST · hỏi "không gian nào?"');
    expect([isPlain('viec cua toi qua han'), isPlain('Việc của tôi'), isPlain('ABC xyz')]).toEqual([true, false, true]);
  });

  it('bao cao vong 2: cot "Bảng / không gian / cột", bang tach cau cu (hoi quy) / cau danh muc moi, nhom I-M', () => {
    const items = CHAT_EVAL_ITEMS.filter((i) => ['A01', 'C04', 'I01', 'K02', 'L03'].includes(i.id));
    const legacy = new Set(CHAT_EVAL_LEGACY_ITEMS.map((i) => i.id));
    const b0: ScoredRun[] = items.map((i) => {
      const env = evalEnvFor(i);
      const pred = runArm('B0', parseByRules(i.question, EVAL_ROSTER, env.catalog), null, prevOf(i), EVAL_ROSTER, env);
      return { itemId: i.id, run: 1, gold: i.gold, pred, score: scoreItem(i.gold, pred) };
    });
    const meta: ChatReportMeta = {
      date: '2026-09-30',
      split: 'dev',
      runs: 1,
      arms: ['B0'],
      provider: '',
      model: '',
      datasetVersion: 'd',
      promptVersion: 'p',
      rulesVersion: 'r',
      apiCalls: 0,
      cacheHits: 0,
      aborted: null,
    };
    const md = buildChatReport(meta, new Map([['B0', b0]]), items, [], legacy);
    for (const part of [
      '| Bảng / không gian / cột |',
      '## Câu cũ (hồi quy) và câu danh mục mới',
      '| câu cũ — hồi quy | 100,0% (2 câu) |',
      '| câu mới — danh mục | 100,0% (3 câu) |',
      '| MY_BOARDS | 100,0% (1 câu) |',
      '| CARD_COUNTS | 100,0% (1 câu) |',
      '| MEMBER_LIST | 100,0% (1 câu) |',
    ]) {
      expect(md, part).toContain(part);
    }
    // chi co cau cu (hoac chi cau moi) -> khong co bang tach
    const onlyNew = buildChatReport(meta, new Map([['B0', b0.filter((r) => !legacy.has(r.itemId))]]), items.filter((i) => !legacy.has(i.id)), [], legacy);
    expect(onlyNew).not.toContain('Câu cũ (hồi quy)');
  });

  it('parseArgs: mac dinh B0 + dev; all = B0,B1,B2; danh sach; runs / delay / items / part', () => {
    expect(parseArgs([])).toEqual({ arms: ['B0'], split: 'dev', runs: 1, delayMs: 4000, items: null, part: 'all', out: null, cacheDir: '.chat-eval-cache' });
    expect(parseArgs(['--part=legacy']).part).toBe('legacy');
    expect(parseArgs(['--part=new']).part).toBe('new');
    expect(parseArgs(['--arm=all', '--split=test', '--runs=3', '--delay=5000', '--out=x.md'])).toMatchObject({
      arms: ['B0', 'B1', 'B2'],
      split: 'test',
      runs: 3,
      delayMs: 5000,
      out: 'x.md',
    });
    expect(parseArgs(['--arm=B2,B0,B2', '--items=A01, C04'])).toMatchObject({ arms: ['B2', 'B0'], items: ['A01', 'C04'] });
  });
});

describe('duong xu ly cua bo danh gia TRUNG voi dich vu that', () => {
  it('B0 tren ca 164 cau: outcomeOf(parseByRules) = ket qua handleMessage (CSDL that dung theo EVAL_CATALOG, ngu canh vang dat vao phien)', async () => {
    // ---- the gioi CSDL dung theo EVAL_CATALOG: 3 khong gian, 11 bang (moi bang co cot dung ten + thu tu), owner la chu ----
    const owner = await prisma.user.create({
      data: { email: `eval_owner_${Date.now()}@test.local`, name: 'Zed Owner', emailVerifiedAt: new Date() },
      select: { id: true },
    });
    const people = [];
    for (const m of EVAL_ROSTER) people.push({ rosterId: m.userId, user: await makeDirectUser(m.name) });
    const wsDb = new Map<string, string>(); // id eval -> id CSDL
    for (const w of EVAL_CATALOG.workspaces) {
      const created = await prisma.workspace.create({
        data: {
          ownerId: owner.id,
          name: w.name,
          isPersonal: w.id === 'ws3',
          members: {
            create: [
              { userId: owner.id, role: 'OWNER' as const },
              // 12 nguoi cua EVAL_ROSTER chi o ws1 (khong gian cua cac cau cu)
              ...(w.id === 'ws1' ? people.map((p) => ({ userId: p.user.id, role: 'MEMBER' as const })) : []),
            ],
          },
        },
        select: { id: true },
      });
      wsDb.set(w.id, created.id);
    }
    for (const b of EVAL_CATALOG.boards) {
      await prisma.board.create({
        data: {
          name: b.name,
          ownerId: owner.id,
          workspaceId: wsDb.get(b.workspaceId)!,
          visibility: 'WORKSPACE',
          lists: { create: EVAL_CATALOG.columns.filter((c) => c.boardId === b.id).map((c, i) => ({ name: c.name, position: i })) },
          members: { create: { userId: owner.id, role: 'OWNER' as const } },
        },
      });
    }
    const toDb = new Map(people.map((p) => [p.rosterId, p.user.id]));
    const nameOf = new Map(EVAL_ROSTER.map((m) => [m.userId, m.name]));
    const entityName = (id: string | null) =>
      id === null ? null : (EVAL_CATALOG.boards.find((b) => b.id === id)?.name ?? EVAL_CATALOG.workspaces.find((w) => w.id === id)?.name ?? `?${id}`);
    const entityLabel = (id: string) => {
      const b = EVAL_CATALOG.boards.find((x) => x.id === id);
      return b ? `Bảng ${b.name} (${b.workspaceName})` : `Không gian ${EVAL_CATALOG.workspaces.find((w) => w.id === id)!.name}`;
    };
    const now = new Date('2026-09-30T03:00:00.000Z');
    const llmOff = { cfg: { baseUrl: '', apiKey: '', model: '', timeoutMs: 1 }, budget: new LlmBudget(), formatModes: new Map() };

    // Danh sach nguoi cua dich vu = 12 nguoi + chu khong gian (ten khong trung tu nao trong cau hoi)
    const roster = [...EVAL_ROSTER, { userId: 'owner', name: 'Zed Owner' }];
    const mismatches: unknown[] = [];
    const kinds = new Set<string>();

    /** Mot luot qua dich vu that; `parsed` = ket qua hieu cau tiem vao (kieu LLM), bo trong = bo luat. */
    async function check(item: Pick<ChatEvalItem, 'question' | 'prev' | 'scope'>, label: string, parsed?: ParsedQuestion) {
      const my = item.scope === 'MY';
      const env = evalEnvFor(item as ChatEvalItem);
      const prev = item.prev;
      const prevCtx: FollowUpContext | null = prev === null ? null : { intent: prev.intent, period: prev.period, focus: prev.focus, memberUserId: prev.member };
      const expected = outcomeOf(parsed ?? parseByRules(item.question, roster, env.catalog), prevCtx, roster, env);
      kinds.add(expected.kind);
      const scopeInput = my ? ({ kind: 'MY' } as const) : ({ kind: 'WORKSPACE', workspaceId: wsDb.get('ws1')! } as const);
      const sessions = new ChatSessionStore();
      const { id, state } = sessions.create(owner.id, my ? 'MY' : `WORKSPACE:${wsDb.get('ws1')}`, now.getTime());
      if (prevCtx) state.context = { ...prevCtx, memberUserId: prev!.member === null ? null : toDb.get(prev!.member)! };
      const understand = parsed ? async () => ({ parsed, parser: 'LLM' as const }) : understandByRules;
      const r = await handleMessage(owner.id, { message: item.question, scope: scopeInput, conversationId: id }, { now, sessions, understand, llm: llmOff });

      const intent = r.understood.intent;
      const catalogIntent = (CATALOG_INTENTS as readonly string[]).includes(intent);
      let got: string;
      if (r.answer.kind === 'UNSUPPORTED') got = 'UNSUPPORTED';
      else if (r.answer.clarify?.question === 'Bạn muốn hỏi về ai?') got = 'ASK_WHO';
      else if (r.answer.kind === 'CLARIFY') {
        const opts = r.answer.clarify!.options;
        if (opts[0]?.kind === 'TARGET') got = `CLARIFY_TARGET|${intent}|${opts.map((o) => o.label).sort().join(',')}`;
        else if (opts[0]?.kind === 'WORKSPACE') got = `ASK_WORKSPACE|${intent}`;
        else got = `CLARIFY:${opts.map((o) => o.label).sort().join(',')}`;
      } else if (r.answer.text.startsWith('Không tìm thấy')) {
        if (!catalogIntent) got = 'MEMBER_NOT_FOUND';
        else {
          const what = r.answer.text.startsWith('Không tìm thấy cột') ? 'COLUMN' : r.answer.text.startsWith('Không tìm thấy không gian') ? 'WORKSPACE' : 'BOARD_OR_WORKSPACE';
          got = `TARGET_NOT_FOUND|${intent}|${what}`;
        }
      } else if (catalogIntent) got = `CATALOG|${intent}|${r.understood.targetName ?? null}|${r.understood.columnName?.toLowerCase() ?? null}`;
      else got = `QUERY|${intent}|${r.understood.period}|${r.understood.focus}|${r.understood.memberName}|${r.answer.ignoredSlots.join(',')}`;

      let want: string;
      if (expected.kind === 'QUERY') want = `QUERY|${expected.intent}|${expected.period}|${expected.focus}|${expected.member === null ? null : nameOf.get(expected.member)}|${expected.ignored.join(',')}`;
      else if (expected.kind === 'CLARIFY_MEMBER') want = `CLARIFY:${expected.candidates.map((c) => nameOf.get(c)).sort().join(',')}`;
      else if (expected.kind === 'CATALOG') want = `CATALOG|${expected.intent}|${entityName(expected.target)}|${expected.column?.toLowerCase() ?? null}`;
      else if (expected.kind === 'CLARIFY_TARGET') want = `CLARIFY_TARGET|${expected.intent}|${expected.candidates.map(entityLabel).sort().join(',')}`;
      else if (expected.kind === 'TARGET_NOT_FOUND') want = `TARGET_NOT_FOUND|${expected.intent}|${expected.what}`;
      else if (expected.kind === 'ASK_WORKSPACE') want = `ASK_WORKSPACE|${expected.intent}`;
      else want = expected.kind;
      if (got !== want) mismatches.push({ label, question: item.question, want, got });
    }

    for (const item of CHAT_EVAL_ITEMS) await check(item, item.id);

    // Ket qua kieu LLM (bo luat khong bao gio sinh ra): hoi "ai?", ten la, xung ho, ten ngoai y dinh, NONE...
    const P2 = (over: Partial<ParsedQuestion>): ParsedQuestion => ({ intent: 'MEMBER_TASKS', period: null, focus: null, member: null, ...over });
    const memberCtx = { intent: 'MEMBER_TASKS' as const, period: null, focus: 'OPEN' as const, member: 'r03' };
    const synthetic: Array<[string, ParsedQuestion, ChatEvalItem['prev']]> = [
      ['hoi ai', P2({}), null],
      ['xung ho', P2({ member: 'anh ấy' }), null],
      ['ten kem tu cam than', P2({ member: 'Lan ơi' }), null],
      ['chi Mai + DONE tuong lai', P2({ member: 'chị Mai', focus: 'DONE', period: 'NEXT_WEEK' }), null],
      ['ho ten day du', P2({ member: 'Nguyễn Thị Lan', focus: 'OVERDUE', period: 'TODAY' }), null],
      ['noi tiep giu nguoi', P2({ intent: 'NONE', focus: 'OVERDUE' }), memberCtx],
      ['noi tiep doi nguoi', P2({ intent: 'NONE', member: 'Lan' }), memberCtx],
      ['noi tiep tu nhac minh', P2({ intent: 'NONE', member: 'tôi' }), { intent: 'TEAM_SUMMARY', period: 'LAST_WEEK', focus: null, member: null }],
      ['noi tiep khong tham so', P2({ intent: 'NONE' }), memberCtx],
      ['ten o cau hoi so viec', P2({ intent: 'TEAM_WORKLOAD', member: 'Hà', period: 'THIS_WEEK' }), null],
      ['uu tien + tham so thua', P2({ intent: 'MY_PRIORITIES', focus: 'BLOCKED', period: 'TOMORROW' }), null],
      ['chua ho tro', P2({ intent: 'UNSUPPORTED', focus: 'DONE' }), null],
    ];
    for (const [label, parsed, prev] of synthetic) await check({ question: 'câu hỏi bất kỳ', prev, scope: undefined }, `tiem: ${label}`, parsed);

    // Ket qua kieu LLM cho cau danh muc (chuoi ten do LLM trich; bo luat khong doan ten khong co tu khoa)
    const C2 = (intent: ParsedQuestion['intent'], over: Partial<ParsedQuestion> = {}): ParsedQuestion => ({ intent, period: null, focus: null, member: null, ...over });
    const catalogInjected: Array<[string, ParsedQuestion, 'MY' | 'WORKSPACE', ChatEvalItem['prev']]> = [
      ['bang theo ten LLM', C2('CARD_COUNTS', { target: 'sprint 12' }), 'MY', null],
      ['bang + cot theo ten LLM', C2('CARD_COUNTS', { target: 'Sprint 13', column: 'xong' }), 'MY', null],
      ['khong gian theo ten LLM', C2('MEMBER_LIST', { target: 'ky thuat' }), 'MY', null],
      ['trung ten bang', C2('MEMBER_LIST', { target: 'website' }), 'MY', null],
      ['bang + khong gian trung ten', C2('CARD_COUNTS', { target: 'marketing' }), 'MY', null],
      ['ten la', C2('CARD_COUNTS', { target: 'khong co bang nay' }), 'MY', null],
      ['cot la', C2('CARD_COUNTS', { column: 'cot la' }), 'MY', null],
      ['MY_BOARDS loc khong gian', C2('MY_BOARDS', { target: 'Kỹ thuật' }), 'MY', null],
      ['MY_BOARDS ten khong phai khong gian', C2('MY_BOARDS', { target: 'Sprint 12' }), 'MY', null],
      ['MY_WORKSPACES kem ten thua', C2('MY_WORKSPACES', { target: 'Marketing', column: 'Xong' }), 'MY', null],
      ['thanh vien khong ten o MY', C2('MEMBER_LIST'), 'MY', null],
      ['thanh vien khong ten o WORKSPACE', C2('MEMBER_LIST'), 'WORKSPACE', null],
      ['thanh vien bang o WORKSPACE', C2('MEMBER_LIST', { target: 'website' }), 'WORKSPACE', null],
      ['bang cua khong gian khac o WORKSPACE', C2('MEMBER_LIST', { target: 'Sprint 12' }), 'WORKSPACE', null],
      ['dem the o WORKSPACE khong ten', C2('CARD_COUNTS'), 'WORKSPACE', null],
      ['danh muc + tham so thua (period/focus/member)', C2('MY_BOARDS', { period: 'NEXT_WEEK', focus: 'OVERDUE', member: 'Lan' }), 'MY', null],
      ['danh muc bo qua ngu canh cau ve nguoi', C2('MY_WORKSPACES'), 'MY', memberCtx],
      ['UNSUPPORTED kem ten', C2('UNSUPPORTED', { target: 'Website' }), 'MY', null],
    ];
    for (const [label, parsed, scope, prev] of catalogInjected) await check({ question: 'câu hỏi bất kỳ', prev, scope }, `tiem danh muc: ${label}`, parsed);

    expect(mismatches).toEqual([]);
    // chot chong "xanh gia": phep doi chieu da di qua MOI loai ket qua
    expect([...kinds].sort()).toEqual(['ASK_WHO', 'ASK_WORKSPACE', 'CATALOG', 'CLARIFY_MEMBER', 'CLARIFY_TARGET', 'MEMBER_NOT_FOUND', 'QUERY', 'TARGET_NOT_FOUND', 'UNSUPPORTED']);
  }, 240_000);
});
