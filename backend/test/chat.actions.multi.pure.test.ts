// Phase 2 - kế hoạch NHIỀU thao tác: phần HÀM THUẦN (không CSDL, không LLM): schema, đồ thị phụ thuộc, tự nối chữ thành tham chiếu
// nội bộ, giới hạn, nguồn gốc cả kế hoạch, loại trùng / mâu thuẫn, nhóm lỗi để đo đạc.
import { describe, expect, it } from 'vitest';
import {
  ACTION_TYPES,
  ActionOpSchema,
  MAX_CREATE_CARDS,
  MAX_CREATE_LISTS,
  MAX_OPS_PER_PLAN,
  MAX_PROPOSED_OPS,
  MAX_REFERENCED,
  PLAN_KEY_RE,
  PROPOSE_ACTIONS_PROVIDER_SCHEMA,
  proposeActionsSchema,
  type ActionOp,
} from '../src/modules/chat/v2/actions/actions.schema';
import { analyzeGraph, checkLimits, graphNodesOf, linkLocalRefs, shapePlan, type GraphNode } from '../src/modules/chat/v2/actions/actions.graph';
import { foldedName, referencedSignatures, refSignature, slotsOf, withRef } from '../src/modules/chat/v2/actions/actions.refs';
import { licenceFor, foldWords } from '../src/modules/chat/v2/actions/actions.text';
import { assessPlanProvenance } from '../src/modules/chat/v2/actions/actions.provenance';
import { dedupeOps } from '../src/modules/chat/v2/actions/actions.resolve';
import { canonicalJson, describeOp, failureCategoryOf, OP_LABEL, planChecksum, stateDigest, staleReasonOf, summarizePlan } from '../src/modules/chat/v2/actions/actions.plan';
import { prepare } from '../src/modules/chat/v2/actions/actions.preflight';
import { laterAssignees, newRunState } from '../src/modules/chat/v2/actions/actions.write';
import type { ActionErrorCode, StoredOp } from '../src/modules/chat/v2/actions/actions.types';
import { handlerOf } from '../src/modules/chat/v2/actions/ops/ops.registry';

const TODAY = '2026-10-07'; // Thứ Tư
const t = (text: string) => ({ by: 'TEXT' as const, text });
const plan = (key: string) => ({ by: 'PLAN' as const, key });
const list = (name: string, key?: string): ActionOp => ({ type: 'CREATE_LIST', name, ...(key ? { key } : {}) });
const card = (title: string, inList?: ReturnType<typeof t> | ReturnType<typeof plan>, key?: string): ActionOp => ({ type: 'CREATE_CARD', title, ...(inList ? { list: inList } : {}), ...(key ? { key } : {}) });
const assign = (c: ReturnType<typeof t> | ReturnType<typeof plan>, member: string): ActionOp => ({ type: 'ASSIGN_MEMBER', card: c, member: t(member) });
const label = (c: ReturnType<typeof t> | ReturnType<typeof plan>, name: string): ActionOp => ({ type: 'ADD_LABEL', card: c, label: t(name) });
const move = (c: string, to: ReturnType<typeof t> | ReturnType<typeof plan>): ActionOp => ({ type: 'MOVE_CARD', card: t(c), toList: to });

describe('A. schema nhiều thao tác', () => {
  it('hợp lệ: tạo cột rồi tạo nhiều thẻ trong cột đó bằng tham chiếu PLAN', () => {
    const ops = [list('Kiểm thử', 'c1'), card('Unit Test', plan('c1')), card('API Test', plan('c1')), card('UI Test', plan('c1'))];
    expect(proposeActionsSchema.safeParse({ operations: ops }).success).toBe(true);
    expect(ops.every((o) => ActionOpSchema.safeParse(o).success)).toBe(true);
    expect([...ACTION_TYPES]).toContain('CREATE_LIST');
  });

  it('từ chối: key sai định dạng, PLAN thiếu / thừa khóa, id lạ, tên cột rỗng hoặc quá dài', () => {
    const bad: unknown[] = [
      { type: 'CREATE_LIST', key: '1abc', name: 'A' },
      { type: 'CREATE_LIST', key: 'a-b', name: 'A' },
      { type: 'CREATE_LIST', key: 'a'.repeat(33), name: 'A' },
      { type: 'CREATE_LIST', name: '' },
      { type: 'CREATE_LIST', name: 'x'.repeat(101) },
      { type: 'CREATE_LIST', name: 'A', boardId: 'b1' },
      { type: 'CREATE_CARD', title: 'A', list: { by: 'PLAN' } },
      { type: 'CREATE_CARD', title: 'A', list: { by: 'PLAN', key: 'c1', id: 'abc' } },
      { type: 'CREATE_CARD', title: 'A', list: { by: 'PLAN', key: 'c 1' } },
      { type: 'CREATE_CARD', title: 'A', list: { by: 'ID', id: 'abc' } },
    ];
    for (const op of bad) expect(ActionOpSchema.safeParse(op).success, JSON.stringify(op)).toBe(false);
    expect(PLAN_KEY_RE.test('list_testing')).toBe(true);
    expect(PLAN_KEY_RE.test('_0')).toBe(false); // khóa tự động của hệ thống bắt đầu bằng "_" nên LLM không thể trùng
  });

  it('trần của schema là MAX_PROPOSED_OPS; giới hạn THẬT của kế hoạch là MAX_OPS_PER_PLAN (kiểm bằng checkLimits)', () => {
    expect(MAX_OPS_PER_PLAN).toBeLessThan(MAX_PROPOSED_OPS);
    const ops = (n: number) => Array.from({ length: n }, (_, i) => label(t(`Thẻ ${i}`), 'Gấp'));
    expect(proposeActionsSchema.safeParse({ operations: ops(MAX_PROPOSED_OPS) }).success).toBe(true);
    expect(proposeActionsSchema.safeParse({ operations: ops(MAX_PROPOSED_OPS + 1) }).success).toBe(false);
    expect(PROPOSE_ACTIONS_PROVIDER_SCHEMA.properties.operations.maxItems).toBe(MAX_PROPOSED_OPS);
    expect(PROPOSE_ACTIONS_PROVIDER_SCHEMA.properties.operations.items.properties.type.enum).toContain('CREATE_LIST');
  });
});

describe('A. đồ thị phụ thuộc: trùng key, tham chiếu thiếu, vòng, sai loại, thứ tự chạy', () => {
  const node = (over: Partial<GraphNode> = {}): GraphNode => ({ refs: [], ...over });

  it('thứ tự chạy theo phụ thuộc, KHÔNG theo thứ tự mảng khi tham chiếu "đi trước" (ổn định khi độc lập)', () => {
    // 0 = thẻ dùng cột c1 (viết TRƯỚC khi cột được tạo), 1 = tạo cột, 2 = thao tác độc lập
    const r = analyzeGraph([node({ key: 'k', creates: 'CARD', refs: [{ key: 'c1', expects: 'LIST' }] }), node({ key: 'c1', creates: 'LIST' }), node()]);
    expect(r).toMatchObject({ ok: true, order: [1, 0, 2], deps: [[1], [], []] });
    const independent = analyzeGraph([node(), node(), node()]);
    expect(independent).toMatchObject({ ok: true, order: [0, 1, 2] });
  });

  it('từ chối key trùng', () => {
    const r = analyzeGraph([node({ key: 'a', creates: 'LIST' }), node({ key: 'a', creates: 'CARD' })]);
    expect(r).toMatchObject({ ok: false, code: 'DUPLICATE_KEY', at: 1 });
    expect(!r.ok && r.text).toContain('Chưa thay đổi gì');
  });

  it('từ chối tham chiếu tới key không tồn tại', () => {
    const r = analyzeGraph([node({ key: 'a', creates: 'CARD', refs: [{ key: 'zzz', expects: 'LIST' }] })]);
    expect(r).toMatchObject({ ok: false, code: 'MISSING_REF', at: 0 });
  });

  it('từ chối VÒNG: tự trỏ chính mình, hai nút trỏ nhau, ba nút xoay vòng', () => {
    const self = analyzeGraph([node({ key: 'a', creates: 'CARD', refs: [{ key: 'a', expects: 'CARD' }] })]);
    expect(self).toMatchObject({ ok: false, code: 'CYCLE' });
    const two = analyzeGraph([
      node({ key: 'a', creates: 'CARD', refs: [{ key: 'b', expects: 'CARD' }] }),
      node({ key: 'b', creates: 'CARD', refs: [{ key: 'a', expects: 'CARD' }] }),
    ]);
    expect(two).toMatchObject({ ok: false, code: 'CYCLE' });
    const three = analyzeGraph([
      node({ key: 'a', creates: 'LIST', refs: [{ key: 'c', expects: 'LIST' }] }),
      node({ key: 'b', creates: 'LIST', refs: [{ key: 'a', expects: 'LIST' }] }),
      node({ key: 'c', creates: 'LIST', refs: [{ key: 'b', expects: 'LIST' }] }),
      node(), // nút ngoài vòng vẫn chạy được nên chỉ báo các nút trong vòng
    ]);
    expect(three).toMatchObject({ ok: false, code: 'CYCLE', at: 0 });
    expect(!three.ok && three.text).toContain('thao tác 1');
    expect(!three.ok && three.text).not.toContain('thao tác 4');
  });

  it('từ chối sai loại: thẻ đưa vào ô cột, cột đưa vào ô thẻ, người / nhãn không thể là thực thể kế hoạch tạo ra', () => {
    const cardIntoList = analyzeGraph([node({ key: 'k', creates: 'CARD' }), node({ refs: [{ key: 'k', expects: 'LIST' }] })]);
    expect(cardIntoList).toMatchObject({ ok: false, code: 'WRONG_KIND', at: 1 });
    const listIntoCard = analyzeGraph([node({ key: 'l', creates: 'LIST' }), node({ refs: [{ key: 'l', expects: 'CARD' }] })]);
    expect(listIntoCard).toMatchObject({ ok: false, code: 'WRONG_KIND' });
    const member = analyzeGraph([node({ key: 'k', creates: 'CARD' }), node({ refs: [{ key: 'k', expects: 'MEMBER' }] })]);
    expect(member).toMatchObject({ ok: false, code: 'WRONG_KIND' });
    const label_ = analyzeGraph([node({ key: 'k', creates: 'CARD' }), node({ refs: [{ key: 'k', expects: 'LABEL' }] })]);
    expect(label_).toMatchObject({ ok: false, code: 'WRONG_KIND' });
  });

  it('mức ưu tiên lỗi: key trùng > thiếu > vòng > sai loại (vòng thẻ-trỏ-thẻ ở ô cột báo VÒNG chứ không phải sai loại)', () => {
    const ops: ActionOp[] = [
      { type: 'CREATE_CARD', key: 'a', title: 'A', list: plan('b') },
      { type: 'CREATE_CARD', key: 'b', title: 'B', list: plan('a') },
    ];
    const r = shapePlan(ops);
    expect(r).toMatchObject({ ok: false, code: 'CYCLE' });
  });

  it('graphNodesOf phản ánh đúng các ô tham chiếu PLAN của từng thao tác', () => {
    const nodes = graphNodesOf([list('X', 'l1'), card('A', plan('l1'), 'c1'), { type: 'MOVE_CARD', card: plan('c1'), toList: plan('l1') }, assign(plan('c1'), 'Lan')]);
    expect(nodes).toEqual([
      { key: 'l1', creates: 'LIST', refs: [] },
      { key: 'c1', creates: 'CARD', refs: [{ key: 'l1', expects: 'LIST' }] },
      { refs: [{ key: 'c1', expects: 'CARD' }, { key: 'l1', expects: 'LIST' }] },
      { refs: [{ key: 'c1', expects: 'CARD' }] },
    ]);
  });
});

describe('A. tự nối chữ thành tham chiếu nội bộ (Gemini hay viết "giao Unit Test cho Nam" thay vì dùng key)', () => {
  it('chữ khớp ĐÚNG tên cột / thẻ mà kế hoạch tạo → thành PLAN; thao tác tạo được gán khóa tự động', () => {
    const r = linkLocalRefs([list('Kiểm thử'), card('Unit Test', t('Kiểm thử')), card('API Test', t('cột Kiểm thử')), assign(t('Unit Test'), 'Nam'), label(t('task API Test'), 'Backend')]);
    expect(r.ok && r.linked).toBe(4);
    if (!r.ok) throw new Error(r.text);
    expect(r.ops[0]).toMatchObject({ key: '_0' });
    expect(r.ops[1]).toMatchObject({ key: '_1', list: plan('_0') });
    expect(r.ops[2]).toMatchObject({ key: '_2', list: plan('_0') });
    expect(r.ops[3]).toMatchObject({ card: plan('_1') });
    expect(r.ops[4]).toMatchObject({ card: plan('_2') });
    expect(PLAN_KEY_RE.test('_0')).toBe(false);
  });

  it('không nối khi chữ KHÔNG khớp tên thực thể mới (giữ là tham chiếu có sẵn) và giữ khóa của người dùng đặt', () => {
    const r = linkLocalRefs([list('Kiểm thử', 'kt'), card('Unit Test', t('Cần làm')), assign(t('Login'), 'Lan')]);
    if (!r.ok) throw new Error(r.text);
    expect(r.linked).toBe(0);
    expect(r.ops[0]).toMatchObject({ key: 'kt' });
    expect(r.ops[1]).toMatchObject({ list: t('Cần làm') });
  });

  it('hai thao tác tạo cùng tên trong một kế hoạch → lỗi (không thể biết tham chiếu trỏ cái nào)', () => {
    const dupCard = linkLocalRefs([card('Unit Test', t('A')), card('unit test', t('A'))]);
    expect(dupCard).toMatchObject({ ok: false, code: 'DUPLICATE_NAME' });
    const dupList = linkLocalRefs([list('Kiểm thử'), list('kiem thu')]);
    expect(dupList).toMatchObject({ ok: false, code: 'DUPLICATE_NAME' });
  });

  it('tham chiếu CONTEXT / SELF / PLAN có sẵn không bị đụng tới', () => {
    const ctx = { type: 'RENAME_CARD', card: { by: 'CONTEXT', slot: 'LAST_CARD' }, title: 'X' } as ActionOp;
    const r = linkLocalRefs([ctx, card('Unit Test', t('A'))]); // "nó" đứng TRƯỚC lệnh tạo: vẫn là thẻ cũ của cuộc trò chuyện
    if (!r.ok) throw new Error(r.text);
    expect(r.ops[0]).toEqual(ctx);
  });

  it('"nó" (CONTEXT) ở thao tác SAU lệnh tạo thẻ / cột thì là thẻ / cột MỚI gần nhất; trước lệnh tạo hoặc không có thì giữ CONTEXT', () => {
    const it = { by: 'CONTEXT' as const, slot: 'LAST_CARD' as const };
    const itList = { by: 'CONTEXT' as const, slot: 'LAST_LIST' as const };
    const r = linkLocalRefs([
      { type: 'RENAME_CARD', card: it, title: 'Trước khi tạo' } as ActionOp, // đứng TRƯỚC mọi lệnh tạo: vẫn là thẻ cũ của cuộc trò chuyện
      list('Kiểm thử'),
      card('Unit Test', t('Kiểm thử')),
      card('API Test', t('Kiểm thử')),
      label(it, 'Backend'), // "nó" = thẻ vừa tạo GẦN NHẤT = API Test
      move('X', itList), // "nó" (cột) = cột vừa tạo
      { type: 'ASSIGN_MEMBER', card: t('Login'), member: { by: 'CONTEXT', slot: 'LAST_MEMBER' } } as ActionOp, // người: không bao giờ được nối
    ]);
    if (!r.ok) throw new Error(r.text);
    expect(r.ops[0]).toMatchObject({ card: it });
    expect(r.ops[4]).toMatchObject({ card: plan('_3') });
    expect(r.ops[5]).toMatchObject({ toList: plan('_1') });
    expect(r.ops[6]).toMatchObject({ member: { by: 'CONTEXT', slot: 'LAST_MEMBER' } });
    expect(r.notes).toEqual(['“nó” được hiểu là thẻ MỚI “API Test” (vừa tạo trong kế hoạch này).', '“nó” được hiểu là cột MỚI “Kiểm thử” (vừa tạo trong kế hoạch này).']);
    // không có lệnh tạo nào thì không đụng tới
    const none = linkLocalRefs([label(it, 'Backend')]);
    expect(none.ok && none.notes).toEqual([]);
    expect(none.ok && none.ops[0]).toMatchObject({ card: it });
  });

  it('shapePlan: gom giới hạn → nối → đồ thị; trả thứ tự chạy với thao tác phụ thuộc đứng sau thao tác tạo', () => {
    // viết LẦN LƯỢT ngược: giao Unit Test (chữ) trước khi tạo nó
    const r = shapePlan([assign(t('Unit Test'), 'Nam'), card('Unit Test', t('Cần làm'))]);
    if (!r.ok) throw new Error(r.text);
    expect(r.order).toEqual([1, 0]);
    expect(r.linked).toBe(1);
  });
});

describe('A. giới hạn số thao tác (đặt ở backend)', () => {
  const cards = (n: number) => Array.from({ length: n }, (_, i) => card(`Thẻ ${i}`, t('Cần làm')));
  it('đúng bằng giới hạn thì qua; vượt bất kỳ giới hạn nào thì từ chối kèm câu "chia nhỏ"', () => {
    expect(MAX_OPS_PER_PLAN).toBe(15);
    expect(MAX_CREATE_CARDS).toBe(10);
    expect(MAX_CREATE_LISTS).toBe(3);
    expect(MAX_REFERENCED).toBe(20);
    expect(checkLimits(cards(MAX_CREATE_CARDS))).toEqual({ ok: true });
    const tooManyCards = checkLimits(cards(MAX_CREATE_CARDS + 1));
    expect(tooManyCards).toMatchObject({ ok: false, code: 'TOO_MANY_CARDS' });
    expect(!tooManyCards.ok && tooManyCards.text).toContain('chia nhỏ');
    expect(checkLimits([list('A'), list('B'), list('C')])).toEqual({ ok: true });
    expect(checkLimits([list('A'), list('B'), list('C'), list('D')])).toMatchObject({ ok: false, code: 'TOO_MANY_LISTS' });
    const labels = Array.from({ length: MAX_OPS_PER_PLAN }, () => label(t('Thẻ 1'), 'Gấp'));
    expect(checkLimits(labels)).toEqual({ ok: true });
    expect(checkLimits([...labels, label(t('Thẻ 1'), 'Gấp')])).toMatchObject({ ok: false, code: 'TOO_MANY_OPS' });
  });

  it('đếm số đối tượng CÓ SẴN khác nhau được nhắc tới (cùng chữ chỉ đếm một lần; PLAN / SELF không đếm)', () => {
    const ops = [assign(t('Login'), 'Lan'), assign(t('task Login'), 'Lan'), label(t('Login'), 'Gấp'), assign(plan('c1'), 'Lan')];
    // thẻ "login" (1) + người "lan" (1) + nhãn "gấp" (1); "task Login" gộp với "Login"
    expect(referencedSignatures(ops).size).toBe(3);
    const many = Array.from({ length: MAX_REFERENCED + 1 }, (_, i) => label(t(`Thẻ ${String.fromCharCode(97 + (i % 26))}${i}`), 'Gấp'));
    expect(checkLimits(many.slice(0, 15))).toEqual({ ok: true });
    // 15 thao tác nhắc 15 thẻ + 1 nhãn = 16 ≤ 20 nên qua; ép vượt bằng nhiều người khác nhau
    const people = Array.from({ length: 15 }, (_, i) => assign(t(`Thẻ ${i}`), `Người ${i}`));
    expect(referencedSignatures(people).size).toBe(30);
    expect(checkLimits(people)).toMatchObject({ ok: false, code: 'TOO_MANY_REFS' });
  });

  it('prepare() đổi lỗi đồ thị thành INVALID_PLAN và giữ nguyên mã giới hạn', () => {
    const cyc = prepare([{ type: 'CREATE_CARD', key: 'a', title: 'A', list: plan('a') }], 'Tạo thẻ A', TODAY);
    expect(cyc).toMatchObject({ ok: false, code: 'INVALID_PLAN' });
    const big = prepare(Array.from({ length: 16 }, (_, i) => label(t(`T${i}`), 'Gấp')), 'Gắn nhãn Gấp cho nhiều thẻ', TODAY);
    expect(big).toMatchObject({ ok: false, code: 'TOO_MANY_OPS' });
    const ok = prepare([list('Kiểm thử'), card('Unit Test', t('Kiểm thử'))], 'Tạo cột Kiểm thử và thêm task Unit Test', TODAY);
    expect(ok.ok && ok.prepared.ordered.map((o) => o.type)).toEqual(['CREATE_LIST', 'CREATE_CARD']);
  });
});

describe('dấu vân tay tham chiếu (một lần tìm, một lần chọn cho mọi chỗ cùng chữ)', () => {
  it('bỏ dấu, hoa thường và từ chung đầu chuỗi; khác loại thì khác khóa', () => {
    expect(refSignature('card', t('task Login'))).toBe(refSignature('card', t('LOGIN')));
    expect(refSignature('card', t('Login'))).not.toBe(refSignature('label', t('Login')));
    // GIỮ DẤU: "Nam" và "Năm" là hai tên khác nhau nên không dùng chung kết quả tìm kiếm / lựa chọn
    expect(refSignature('member', t('Nam'))).toBe(refSignature('member', t('nam')));
    expect(refSignature('member', t('Nam'))).not.toBe(refSignature('member', t('Năm')));
    expect(refSignature('list', undefined)).toBe('list:none');
    expect(refSignature('card', { by: 'CONTEXT', slot: 'LAST_CARD' })).toBe('card:c:LAST_CARD');
    expect(refSignature('member', { by: 'SELF' })).toBe('member:self');
    expect(refSignature('card', plan('x'))).toBeNull();
    expect(foldedName('cột Đang làm')).toBe('dang lam');
  });

  it('slotsOf / withRef đủ cho MỌI loại thao tác (10 loại cũ + 8 loại của bước D + 13 loại của bước E; bước F-I có handler riêng)', () => {
    for (const type of ACTION_TYPES) {
      const samples: Record<string, ActionOp> = {
        CREATE_LIST: list('A'),
        CREATE_CARD: card('A'),
        RENAME_CARD: { type: 'RENAME_CARD', card: t('A'), title: 'B' },
        SET_CARD_DUE: { type: 'SET_CARD_DUE', card: t('A'), due: { type: 'NONE' } },
        MOVE_CARD: move('A', t('B')),
        SET_CARD_STATUS: { type: 'SET_CARD_STATUS', card: t('A'), status: 'DONE' },
        ASSIGN_MEMBER: assign(t('A'), 'Lan'),
        ADD_LABEL: label(t('A'), 'Gấp'),
        ASSIGN_UNASSIGNED: { type: 'ASSIGN_UNASSIGNED', list: t('A') },
        CREATE_AUTOMATION_RULE: { type: 'CREATE_AUTOMATION_RULE', trigger: 'CARD_MOVED_TO_LIST', list: t('A'), actions: [{ type: 'ADD_LABEL', label: t('B') }] },
        SET_CARD_DESCRIPTION: { type: 'SET_CARD_DESCRIPTION', card: t('A'), description: 'mô tả' },
        SET_CARD_START: { type: 'SET_CARD_START', card: t('A'), start: { type: 'NONE' } },
        ADD_COMMENT: { type: 'ADD_COMMENT', card: t('A'), text: 'ok' },
        ADD_CHECKLIST: { type: 'ADD_CHECKLIST', card: t('A'), items: ['a'] },
        REMOVE_MEMBER: { type: 'REMOVE_MEMBER', card: t('A'), member: t('Lan') },
        REMOVE_LABEL: { type: 'REMOVE_LABEL', card: t('A'), label: t('Gấp') },
        RENAME_LIST: { type: 'RENAME_LIST', list: t('A'), name: 'B' },
        ARCHIVE_CARD: { type: 'ARCHIVE_CARD', card: t('A') },
        DELETE_CARD: { type: 'DELETE_CARD', card: t('A') },
        RESTORE_CARD: { type: 'RESTORE_CARD', card: t('A') },
        COPY_CARD: { type: 'COPY_CARD', card: t('A') },
        SET_CARD_COVER: { type: 'SET_CARD_COVER', card: t('A'), color: 'RED' },
        ARCHIVE_LIST: { type: 'ARCHIVE_LIST', list: t('A') },
        DELETE_LIST: { type: 'DELETE_LIST', list: t('A') },
        RESTORE_LIST: { type: 'RESTORE_LIST', list: t('A') },
        COPY_LIST: { type: 'COPY_LIST', list: t('A') },
        MOVE_LIST: { type: 'MOVE_LIST', list: t('A'), placement: 'FIRST' },
        SORT_LIST: { type: 'SORT_LIST', list: t('A'), sortBy: 'TITLE_ASC' },
        MOVE_ALL_CARDS: { type: 'MOVE_ALL_CARDS', list: t('A'), toList: t('B') },
        DELETE_ALL_CARDS: { type: 'DELETE_ALL_CARDS', list: t('A') },
        SET_LIST_STATUS: { type: 'SET_LIST_STATUS', list: t('A'), status: 'DONE' },
      };
      const op = samples[type];
      // bước F-I: slots của từng thao tác nằm ở handler của nhóm và được kiểm trong test của nhóm đó
      if (op === undefined) {
        expect(handlerOf(type), type).toBeDefined();
        continue;
      }
      const names = slotsOf(op).map((s) => s.name);
      expect(names, type).toEqual({ CREATE_LIST: [], CREATE_CARD: ['list'], RENAME_CARD: ['card'], SET_CARD_DUE: ['card'], MOVE_CARD: ['card', 'toList'], SET_CARD_STATUS: ['card'], ASSIGN_MEMBER: ['card', 'member'], ADD_LABEL: ['card', 'label'], ASSIGN_UNASSIGNED: ['list'], CREATE_AUTOMATION_RULE: ['list', 'a0.label'], SET_CARD_DESCRIPTION: ['card'], SET_CARD_START: ['card'], ADD_COMMENT: ['card'], ADD_CHECKLIST: ['card'], REMOVE_MEMBER: ['card', 'member'], REMOVE_LABEL: ['card', 'label'], RENAME_LIST: ['list'], ARCHIVE_CARD: ['card'], DELETE_CARD: ['card'], RESTORE_CARD: ['card'], COPY_CARD: ['card'], SET_CARD_COVER: ['card'], ARCHIVE_LIST: ['list'], DELETE_LIST: ['list'], RESTORE_LIST: ['list'], COPY_LIST: ['list'], MOVE_LIST: ['list'], SORT_LIST: ['list'], MOVE_ALL_CARDS: ['list', 'toList'], DELETE_ALL_CARDS: ['list'], SET_LIST_STATUS: ['list'] }[type]);
      // luật tự động hóa chỉ nhắm vào thực thể CÓ SẴN nên không nhận tham chiếu PLAN (withRef bỏ qua)
      const probe = type === 'CREATE_AUTOMATION_RULE' ? t('Z') : plan('k');
      for (const name of names) expect(slotsOf(withRef(op, name, probe)).find((s) => s.name === name)?.ref).toEqual(probe);
    }
  });
});

describe('giấy phép động từ & nguồn gốc của CẢ kế hoạch', () => {
  const lic = (type: string, message: string) => licenceFor(type, foldWords(message));

  it('CREATE_LIST: động từ tạo phải đứng SÁT danh từ "cột" (tối đa 3 từ), nếu không thì không phải lệnh tạo cột', () => {
    expect(lic('CREATE_LIST', 'Tạo cột Kiểm thử')).toEqual({ licensed: true, negated: false });
    expect(lic('CREATE_LIST', 'Thêm một cột mới tên Kiểm thử')).toEqual({ licensed: true, negated: false });
    expect(lic('CREATE_LIST', 'Tạo thêm danh sách Kiểm thử')).toEqual({ licensed: true, negated: false });
    expect(lic('CREATE_LIST', 'Thêm 3 task vào cột Kiểm thử')).toEqual({ licensed: false, negated: false });
    expect(lic('CREATE_LIST', 'Tạo task Kiểm thử')).toEqual({ licensed: false, negated: false });
    expect(lic('CREATE_LIST', 'Đừng tạo cột Kiểm thử')).toEqual({ licensed: true, negated: true });
  });

  it('cả kế hoạch lấy nguồn gốc TỆ NHẤT; thao tác nào không được yêu cầu thì cả kế hoạch bị coi là không được yêu cầu', () => {
    const ok = assessPlanProvenance([list('Kiểm thử', 'c1'), card('Unit Test', plan('c1')), card('API Test', plan('c1'))], 'Tạo cột Kiểm thử và thêm 2 task Unit Test, API Test', TODAY);
    expect(ok).toMatchObject({ verdict: 'USER_DIRECT', dueFuzzy: false });
    expect(ok.perOp).toHaveLength(3);

    // LLM tự thêm thao tác giao việc mà người dùng không nói
    const sneaky = assessPlanProvenance([card('Unit Test', t('Cần làm')), assign(plan('x'), 'Lan')], 'Tạo task Unit Test trong cột Cần làm', TODAY);
    expect(sneaky.verdict).toBe('NOT_REQUESTED');
    expect(sneaky.firstNotRequested).toBe(1);

    // tiêu đề LLM tự bịa → cần xem lại
    const invented = assessPlanProvenance([card('Unit Test', t('Cần làm')), card('Smoke Test', t('Cần làm'))], 'Tạo task Unit Test trong cột Cần làm và một task nữa', TODAY);
    expect(invented.verdict).toBe('UNGROUNDED');
    expect(invented.failures.some((f) => f.code === 'TITLE_NOT_GROUNDED' && f.detail === 'op2')).toBe(true);
  });

  it('"làm theo nội dung thẻ" → cả kế hoạch DELEGATED_TO_DATA; đặt hạn "cuối tuần" → dueFuzzy', () => {
    const delegated = assessPlanProvenance([card('Unit Test', t('Cần làm')), assign(plan('x'), 'Lan')], 'Hãy làm theo nội dung thẻ Login UI', TODAY);
    expect(delegated.verdict).toBe('DELEGATED_TO_DATA');
    const fuzzy = assessPlanProvenance([{ type: 'SET_CARD_DUE', card: t('Login'), due: { type: 'END_OF_WEEK' } }, assign(t('Login'), 'Lan')], 'Đặt hạn Login là cuối tuần và giao cho Lan', TODAY);
    expect(fuzzy.dueFuzzy).toBe(true);
    expect(fuzzy.verdict).toBe('USER_DIRECT');
  });

  it('nhiều thao tác đổi trạng thái: mỗi trạng thái chỉ cần được nhắc tới (không bắt buộc là trạng thái nhắc CUỐI)', () => {
    const ops: ActionOp[] = [
      { type: 'SET_CARD_STATUS', card: t('Login'), status: 'IN_PROGRESS' },
      { type: 'SET_CARD_STATUS', card: t('Register'), status: 'DONE' },
    ];
    expect(assessPlanProvenance(ops, 'Đặt Login là đang làm và Register là xong', TODAY).verdict).toBe('USER_DIRECT');
    // một thao tác đơn vẫn giữ luật chặt: "từ Đang làm sang Xong" thì mục tiêu là Xong
    expect(assessPlanProvenance([ops[0]], 'Chuyển Login từ đang làm sang xong', TODAY).verdict).toBe('NOT_REQUESTED');
  });
});

describe('loại trùng / mâu thuẫn giữa các thao tác đã phân giải', () => {
  const op = (over: Partial<StoredOp> & Pick<StoredOp, 'type'>): StoredOp => ({ ids: {}, params: {}, before: null, display: { cardTitle: 'Login' }, ...over });

  it('cùng thẻ, cùng loại thao tác độc quyền, GIÁ TRỊ KHÁC → mâu thuẫn; giống hệt → bỏ cái sau', () => {
    const a = op({ type: 'SET_CARD_DUE', ids: { card: 'c1' }, params: { due: '2026-10-09T16:59:00.000Z' } });
    const b = op({ type: 'SET_CARD_DUE', ids: { card: 'c1' }, params: { due: '2026-10-10T16:59:00.000Z' } });
    const conflict = dedupeOps([a, b]);
    expect(conflict.ok).toBe(false);
    expect(!conflict.ok && conflict.text).toContain('đổi hạn');
    expect(dedupeOps([a, { ...a }])).toMatchObject({ ok: true, dropped: 1 });
    expect(dedupeOps([a, { ...b, ids: { card: 'c2' } }])).toMatchObject({ ok: true, dropped: 0 });
  });

  it('vừa chuyển cột vừa đổi trạng thái cùng một thẻ → mâu thuẫn; giao cùng người / gắn cùng nhãn hai lần → bỏ trùng', () => {
    const mv = op({ type: 'MOVE_CARD', ids: { card: 'c1', list: 'l1' } });
    const st = op({ type: 'SET_CARD_STATUS', ids: { card: 'c1' }, params: { status: 'DONE' } });
    expect(dedupeOps([mv, st]).ok).toBe(false);
    expect(dedupeOps([st, mv]).ok).toBe(false);
    const as = op({ type: 'ASSIGN_MEMBER', ids: { card: 'c1', member: 'u1' } });
    expect(dedupeOps([as, { ...as }, op({ type: 'ASSIGN_MEMBER', ids: { card: 'c1', member: 'u2' } })])).toMatchObject({ ok: true, dropped: 1 });
    const lb = op({ type: 'ADD_LABEL', ids: { card: 'c1', label: 'x' } });
    expect(dedupeOps([lb, { ...lb }])).toMatchObject({ ok: true, dropped: 1 });
  });

  it('thẻ do kế hoạch tạo (nhận diện bằng key) cũng được kiểm; đổi tên hai lần khác nhau → mâu thuẫn', () => {
    const r1 = op({ type: 'RENAME_CARD', local: { card: 'k1' }, params: { title: 'A' } });
    const r2 = op({ type: 'RENAME_CARD', local: { card: 'k1' }, params: { title: 'B' } });
    expect(dedupeOps([r1, r2]).ok).toBe(false);
    expect(dedupeOps([r1, { ...r2, local: { card: 'k2' } }])).toMatchObject({ ok: true, dropped: 0 });
  });
});

describe('xem trước, kết quả, dấu vân tay trạng thái, nhóm lỗi', () => {
  const op = (over: Partial<StoredOp> & Pick<StoredOp, 'type'>): StoredOp => ({ ids: {}, params: {}, before: null, display: {}, ...over });

  it('mô tả CREATE_LIST và các thao tác nhắm vào thẻ / cột MỚI của kế hoạch', () => {
    expect(describeOp(op({ type: 'CREATE_LIST', params: { name: 'Kiểm thử', listStatus: 'IN_REVIEW' } }), 0)).toMatchObject({ verb: 'Tạo cột', text: '“Kiểm thử”' });
    expect(describeOp(op({ type: 'CREATE_LIST', params: { name: 'Ý tưởng', listStatus: null } }), 0).detail).toBeUndefined();
    expect(describeOp(op({ type: 'CREATE_LIST', params: { name: 'Kiểm thử', listStatus: 'IN_REVIEW' } }), 0).detail).toContain('Chờ duyệt');
    expect(describeOp(op({ type: 'CREATE_CARD', local: { list: 'c1' }, params: { title: 'Unit Test' }, display: { listName: 'Kiểm thử' } }), 1)).toMatchObject({ verb: 'Tạo thẻ', detail: 'Trong cột mới “Kiểm thử”' });
    expect(describeOp(op({ type: 'CREATE_CARD', ids: { list: 'l1' }, params: { title: 'Unit Test' }, display: { listName: 'Cần làm' } }), 1).detail).toBe('Trong cột “Cần làm”');
    expect(describeOp(op({ type: 'ASSIGN_MEMBER', local: { card: 'k' }, display: { cardTitle: 'Unit Test', memberName: 'Nam' } }), 2).text).toBe('“Unit Test” (thẻ mới) cho Nam');
    expect(describeOp(op({ type: 'MOVE_CARD', local: { card: 'k', list: 'c1' }, display: { cardTitle: 'Unit Test', toListName: 'Kiểm thử' } }), 3)).toMatchObject({ detail: '→ cột mới “Kiểm thử”' });
    expect(describeOp(op({ type: 'SET_CARD_STATUS', local: { card: 'k' }, params: { status: 'DONE' }, display: { cardTitle: 'Unit Test' } }), 4).detail).toBe('→ Hoàn thành');
    for (const type of ACTION_TYPES) expect(OP_LABEL[type].length).toBeGreaterThan(3);
  });

  it('tóm tắt kết quả: một thao tác giữ nguyên câu Phase 1; nhiều thao tác đếm số thay đổi và số thao tác bỏ qua', () => {
    expect(summarizePlan('Alpha', [{ text: 'Đã tạo thẻ “A”.', changed: true }])).toBe('Đã tạo thẻ “A”.');
    expect(summarizePlan('Alpha', [{ text: 'a', changed: true }, { text: 'b', changed: true }])).toBe('Đã áp dụng 2 thay đổi trên bảng “Alpha”.');
    expect(summarizePlan('Alpha', [{ text: 'a', changed: true }, { text: 'b', changed: false }])).toBe('Đã áp dụng 1 thay đổi trên bảng “Alpha”. Bỏ qua 1 thao tác đã có sẵn.');
    expect(summarizePlan('Alpha', [{ text: 'a', changed: false }, { text: 'b', changed: false }])).toContain('đều đã có sẵn');
  });

  it('stateDigest đổi khi giá trị CŨ, tên hiển thị hoặc tham số đổi; không phụ thuộc thứ tự khóa; checksum tính cả key và tham chiếu nội bộ', () => {
    const base = [op({ type: 'RENAME_CARD', ids: { card: 'c1' }, params: { title: 'B' }, before: { title: 'A' }, display: { cardTitle: 'A' } })];
    const d = stateDigest(base);
    expect(stateDigest([{ ...base[0] }])).toBe(d);
    expect(stateDigest([{ ...base[0], before: { title: 'A2' } }])).not.toBe(d);
    expect(stateDigest([{ ...base[0], display: { cardTitle: 'A2' } }])).not.toBe(d);
    expect(stateDigest([{ ...base[0], params: { title: 'C' } }])).not.toBe(d);
    expect(stateDigest([{ ...base[0], noop: 'x' }])).not.toBe(d);
    expect(canonicalJson({ b: 1, a: [2, undefined] })).toBe('{"a":[2,null],"b":1}');
    const a = [op({ type: 'CREATE_CARD', key: 'k1', local: { list: 'l1' }, params: { title: 'T' } })];
    expect(planChecksum({ userId: 'u', boardId: 'b', ops: a })).not.toBe(planChecksum({ userId: 'u', boardId: 'b', ops: [{ ...a[0], key: 'k2' }] }));
    expect(planChecksum({ userId: 'u', boardId: 'b', ops: a })).not.toBe(planChecksum({ userId: 'u', boardId: 'b', ops: [{ ...a[0], local: { list: 'l2' } }] }));
    expect(staleReasonOf(base[0], { ...base[0], before: { title: 'Z' } })).toContain('đổi tên');
    expect(staleReasonOf(base[0], { ...base[0], ids: { card: 'c2' } })).toContain('khác');
    expect(staleReasonOf(op({ type: 'MOVE_CARD' }), op({ type: 'MOVE_CARD' }))).toContain('chuyển');
  });

  it('nhóm lỗi dùng để đo đạc (failureCategory) phủ MỌI mã lỗi', () => {
    const codes: Record<ActionErrorCode, string> = {
      ACTIONS_DISABLED: 'DISABLED', AI_UNAVAILABLE: 'DISABLED', NO_BOARD: 'RESOLVE', MULTI_OP: 'LIMIT', TOO_MANY_OPS: 'LIMIT', TOO_MANY_CARDS: 'LIMIT',
      TOO_MANY_LISTS: 'LIMIT', TOO_MANY_REFS: 'LIMIT', INVALID_PLAN: 'GRAPH', CONFLICT: 'CONFLICT', INTERRUPTED: 'EXECUTION', NOT_REQUESTED: 'NOT_REQUESTED',
      NOT_FOUND: 'RESOLVE', AMBIGUOUS: 'RESOLVE', FORBIDDEN: 'PERMISSION', VIEWER_ASSIGN: 'PERMISSION', OUT_OF_SCOPE: 'SCOPE', INVALID: 'INVALID',
      STALE: 'STALE', EXPIRED: 'EXPIRED', ALREADY_DECIDED: 'CANCELLED', SUPERSEDED: 'CANCELLED', SCOPE_CHANGED: 'SCOPE', SERVICE_ERROR: 'EXECUTION',
    };
    for (const [code, category] of Object.entries(codes)) expect(failureCategoryOf(code as ActionErrorCode), code).toBe(category);
    expect(failureCategoryOf(null)).toBeNull();
    expect(failureCategoryOf(undefined)).toBeNull();
  });

  it('laterAssignees: thông báo của thao tác trước không gửi cho người chỉ được giao ở thao tác SAU', () => {
    const state = newRunState();
    state.created.set('k', { key: 'k', id: 'real-card', kind: 'CARD', name: 'T' });
    const ops = [
      op({ type: 'SET_CARD_DUE', ids: { card: 'c1' } }),
      op({ type: 'ASSIGN_MEMBER', ids: { card: 'c1', member: 'u-nam' } }),
      op({ type: 'ASSIGN_MEMBER', ids: { card: 'c1', member: 'u-da-co' }, noop: 'đã có' }),
      op({ type: 'RENAME_CARD', local: { card: 'k' } }),
      op({ type: 'ASSIGN_MEMBER', local: { card: 'k' }, ids: { member: 'u-minh' } }),
    ];
    const excl = laterAssignees(ops, state);
    expect(excl(0)('c1')).toEqual(['u-nam']); // thao tác 0 (đặt hạn) chạy trước khi Nam được giao
    expect(excl(1)('c1')).toEqual([]); // sau khi giao Nam thì Nam là thành viên bình thường
    expect(excl(3)('real-card')).toEqual(['u-minh']); // thẻ do kế hoạch tạo: nhận diện qua state.created
    expect(excl(0)('c-khac')).toEqual([]);
  });
});
