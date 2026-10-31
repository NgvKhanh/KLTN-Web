// Nhan xet AI cho tong ket nhom (CHATBOT_MODULE.md §11): du lieu gui di + bo kiem tra.
// KHONG ra mang that: fetch gia (test/llmFake.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmConfig } from '../src/modules/ai/ai.llm';
import { LlmBudget, type ChatLlmDeps } from '../src/modules/chat/chat.llm';
import {
  allowedNumbers,
  buildCommentMessages,
  COMMENT_JSON_SCHEMA,
  COMMENT_RESERVE,
  digitRuns,
  MAX_COMMENT_CHARS,
  requestSummaryComment,
  summaryPayload,
  validateComment,
  type SummaryInput,
} from '../src/modules/chat/chat.summary';
import { completion, forbidFetch, json, stubFetch } from './llmFake';

const CFG: LlmConfig = { baseUrl: 'https://llm.test/v1', apiKey: 'khoa-gia', model: 'model-gia', timeoutMs: 2000 };
const T = 1_800_000_000_000;
const deps = (over: Partial<LlmConfig> = {}): ChatLlmDeps => ({ cfg: { ...CFG, ...over }, budget: new LlmBudget(), formatModes: new Map() });

// Ten trung tu thuong: Thành (hoàn thành), Công (công việc), Tiến (tiến độ), Trung (tập trung),
// Mai (ngày mai), An (an toàn), Nhóm (từ khoá của bộ luật)
const ROSTER = [
  { userId: 'u1', name: 'Nguyễn Văn Thành' },
  { userId: 'u2', name: 'Lê Chí Công' },
  { userId: 'u3', name: 'Trần Tiến' },
  { userId: 'u4', name: 'Hoàng Mai' },
  { userId: 'u5', name: 'Trưởng Nhóm' },
  { userId: 'u6', name: 'Nguyễn Thị Lan' },
  { userId: 'u7', name: 'Phạm An' },
  { userId: 'u8', name: 'Lê Quang Trung' },
  { userId: 'u9', name: 'Lê Tuấn' },
];

const INPUT: SummaryInput = {
  periodLabel: 'trong 7 ngày tới',
  scopeKind: 'WORKSPACE',
  counts: { doneInPeriod: 3, dueInPeriod: 4, open: 12, overdue: 2, blocked: 1, unassignedOpen: 0 },
};
const PAYLOAD = summaryPayload(INPUT);
const ALLOWED = allowedNumbers(PAYLOAD);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('du lieu gui LLM (§11)', () => {
  it('chi nhan ky, loai pham vi va 6 con so cua ban tong ket; bo so khong thuoc tong ket; ky tuong lai khong co "hoàn thành"', () => {
    expect(PAYLOAD).toEqual({
      'kỳ': 'trong 7 ngày tới',
      'phạm vi': 'một không gian làm việc',
      'số liệu': {
        'hoàn thành trong kỳ': 3,
        'chưa xong, đến hạn trong kỳ': 4,
        'chưa xong (tổng)': 12,
        'quá hạn': 2,
        'bị chặn': 1,
        'chưa giao cho ai, chưa xong': 0,
      },
    });
    const extra = summaryPayload({ periodLabel: 'tuần sau', scopeKind: 'BOARD', counts: { total: 99, dueToday: 7, dueSoon: 8, open: 5, overdue: 0, blocked: 0, unassignedOpen: 1, dueInPeriod: 2 } });
    expect(extra).toEqual({
      'kỳ': 'tuần sau',
      'phạm vi': 'một bảng',
      'số liệu': { 'chưa xong, đến hạn trong kỳ': 2, 'chưa xong (tổng)': 5, 'quá hạn': 0, 'bị chặn': 0, 'chưa giao cho ai, chưa xong': 1 },
    });
    expect([...ALLOWED].sort()).toEqual(['0', '1', '12', '2', '3', '4', '7']);
    expect(digitRuns('a12b3 45,6')).toEqual(['12', '3', '45', '6']);
    expect(digitRuns('không số')).toEqual([]);

    const m = buildCommentMessages(PAYLOAD);
    expect(m.user).toBe(`<<<DU_LIEU\n${JSON.stringify(PAYLOAD)}\nDU_LIEU>>>`);
    expect(buildCommentMessages(extra).system).toBe(m.system); // he thong tinh
    for (const rule of ['DỮ LIỆU', 'Không viết số bằng chữ', 'Không nhắc tên người', 'tối đa 300 ký tự', 'Chỉ viết hoa chữ đầu câu']) {
      expect(m.system, rule).toContain(rule);
    }
  });
});

describe('kiem tra nhan xet (ham thuan)', () => {
  it('nhan xet hop le duoc giu - ke ca khi nhom co nguoi ten Thành / Công / Tiến / Trung / Mai / An / "Trưởng Nhóm"', () => {
    const good = [
      'Tuần này nhóm đã hoàn thành 3 việc, còn 2 việc quá hạn cần xử lý sớm.',
      'Tiến độ ổn định. Công việc còn 12 việc chưa xong, nên gỡ chặn 1 việc trước.',
      'Nhóm có 2 việc quá hạn. An toàn nhất là xử lý chúng trong 7 ngày tới.',
      'Nhóm cần tập trung vào 2 việc quá hạn!',
      'Ngày mai nên xử lý 2 việc quá hạn.',
      'Lưu ý: Nhóm có 1 việc bị chặn.',
      'Việc chưa giao là 0, rất tốt.',
      'Tuần này có 4 việc đến hạn.', // "tuần" khong phai Tuấn
      'Nhóm khá hài lòng với 3 việc đã xong.', // "hài" co dau khac "hai"
      'Kỳ này ổn… Còn 1 việc bị chặn.',
    ];
    const wrong = good.map((c) => [c, validateComment({ comment: c }, ALLOWED, ROSTER)] as const).filter(([, r]) => !r.ok);
    expect(wrong).toEqual([]);
    // cat khoang trang, doi NFD -> NFC
    expect(validateComment({ comment: '  Nhóm có 2 việc quá hạn.  ' }, ALLOWED, ROSTER)).toEqual({ ok: true, text: 'Nhóm có 2 việc quá hạn.' });
    const nfd = 'Nhóm có 2 việc quá hạn.'.normalize('NFD');
    expect(validateComment({ comment: nfd }, ALLOWED, ROSTER)).toEqual({ ok: true, text: 'Nhóm có 2 việc quá hạn.' });
    // bien do dai: dung 300 ky tu van qua - dem theo KY TU (emoji = 2 don vi UTF-16 nhung 1 ky tu)
    const edge = `Nhóm ${'😀'.repeat(MAX_COMMENT_CHARS - 5)}`;
    expect([Array.from(edge).length, edge.length]).toEqual([300, 595]);
    expect(validateComment({ comment: edge }, ALLOWED, ROSTER).ok).toBe(true);
    expect(validateComment({ comment: `${edge}😀` }, ALLOWED, ROSTER)).toEqual({ ok: false, reason: 'TOO_LONG' });
    expect(MAX_COMMENT_CHARS).toBe(300);
  });

  it('moi luat loai co ca rieng (moi cau chi vi pham dung mot luat)', () => {
    const rows: Array<[unknown, string]> = [
      ['chuoi tran', 'SHAPE'],
      [null, 'SHAPE'],
      [{}, 'SHAPE'],
      [{ comment: 3 }, 'SHAPE'],
      [{ comment: 'Nhóm ổn.', extra: 1 }, 'SHAPE'],
      [{ comment: '   ' }, 'EMPTY'],
      [{ comment: `Nhóm ${'x'.repeat(296)}` }, 'TOO_LONG'],
      [{ comment: 'Nhóm **ổn**.' }, 'MARKUP'],
      [{ comment: '# Nhóm ổn.' }, 'MARKUP'],
      [{ comment: 'Xem [đây](x).' }, 'MARKUP'],
      [{ comment: 'Xem https:x.y nhé.' }, 'MARKUP'],
      [{ comment: 'Xem www.abc.vn nhé.' }, 'MARKUP'],
      [{ comment: 'Nhóm ổn.\nCòn việc.' }, 'MARKUP'],
      [{ comment: 'Gửi @nhóm nhé.' }, 'MARKUP'],
      [{ comment: 'Việc a_b còn.' }, 'MARKUP'],
      [{ comment: 'Nhóm <b>ổn</b>.' }, 'MARKUP'],
      [{ comment: 'Nhóm `ổn`.' }, 'MARKUP'],
      [{ comment: 'Nhóm ổn | tốt.' }, 'MARKUP'],
      [{ comment: 'Nhóm ~ổn.' }, 'MARKUP'],
      [{ comment: 'Nhóm\tổn.' }, 'MARKUP'],
      [{ comment: 'Đạt 3% kế hoạch.' }, 'PERCENT'],
      [{ comment: 'Nhóm có 5 việc quá hạn.' }, 'NUMBER'],
      [{ comment: 'Nhóm có 03 việc.' }, 'NUMBER'],
      [{ comment: 'Nhóm có 2,1 việc.' }, 'NUMBER'],
      [{ comment: 'Nhóm có 2.1 việc.' }, 'NUMBER'],
      [{ comment: 'Nhóm có ٢ việc.' }, 'NUMBER'],
      [{ comment: 'Nhóm có Ⅻ việc.' }, 'NUMBER'],
      [{ comment: 'Nhóm có hai việc quá hạn.' }, 'NUMBER_WORD'],
      [{ comment: 'Có một số việc quá hạn.' }, 'NUMBER_WORD'],
      [{ comment: 'Còn mười việc.' }, 'NUMBER_WORD'],
      [{ comment: 'Còn nửa số việc.' }, 'NUMBER_WORD'],
      [{ comment: 'Đạt vài phần trăm.' }, 'NUMBER_WORD'],
      [{ comment: 'Nhom con mot so viec.' }, 'NUMBER_WORD'], // go khong dau
      [{ comment: 'Nhóm cần chú ý, anh Tiến có 2 việc quá hạn.' }, 'PROPER_NOUN'],
      [{ comment: 'Có 2 việc quá hạn ở Dự án.' }, 'PROPER_NOUN'],
      [{ comment: 'Nhóm có 1 việc bị chặn. Trưởng Nhóm nên xem.' }, 'PROPER_NOUN'],
      [{ comment: 'Thành đang giữ 2 việc.' }, 'MEMBER_NAME'],
      [{ comment: 'Lan có 2 việc quá hạn.' }, 'MEMBER_NAME'],
      [{ comment: 'Nhóm ổn. Mai cần xử lý 2 việc.' }, 'MEMBER_NAME'],
      [{ comment: 'Nhóm ổn. Tuấn.' }, 'MEMBER_NAME'], // cau chi co mot tu
      [{ comment: 'Tuấn' }, 'MEMBER_NAME'],
    ];
    const wrong: unknown[] = [];
    for (const [raw, want] of rows) {
      const got = validateComment(raw, ALLOWED, ROSTER);
      if (got.ok || got.reason !== want) wrong.push({ raw, want, got });
    }
    expect(wrong).toEqual([]);
    // cung cau, danh sach nguoi KHONG co ten do -> qua (luat ten dua vao danh sach, khong doan)
    expect(validateComment({ comment: 'Thành đang giữ 2 việc.' }, ALLOWED, []).ok).toBe(true);
    // ten luu khong dau khop ca tu co dau (than trong: loai nham con hon hien sai)
    expect(validateComment({ comment: 'Tuần có 2 việc.' }, ALLOWED, [{ userId: 'x', name: 'Tuan' }])).toEqual({ ok: false, reason: 'MEMBER_NAME' });
  });

  it('tinh chat: 400 bo so ngau nhien - nhan xet dung dung so da gui thi qua; doi mot so thanh so la / chen ten thanh vien thi bi loai', () => {
    let seed = 20260929;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const wrong: unknown[] = [];
    for (let i = 0; i < 400; i++) {
      const counts = { doneInPeriod: rnd(30), dueInPeriod: rnd(30), open: rnd(300), overdue: rnd(30), blocked: rnd(10), unassignedOpen: rnd(10) };
      const payload = summaryPayload({ periodLabel: ['tuần này', 'tuần trước', 'hôm nay'][rnd(3)], scopeKind: 'WORKSPACE', counts });
      const allowed = allowedNumbers(payload);
      const good = `Kỳ này nhóm hoàn thành ${counts.doneInPeriod} việc, còn ${counts.open} việc chưa xong. Trong đó có ${counts.overdue} việc quá hạn và ${counts.blocked} việc bị chặn.`;
      if (!validateComment({ comment: good }, allowed, ROSTER).ok) wrong.push({ i, good });
      let alien = 301 + rnd(500);
      while (allowed.has(String(alien))) alien += 1;
      const bad = good.replace(`${counts.open} việc chưa xong`, `${alien} việc chưa xong`);
      const r = validateComment({ comment: bad }, allowed, ROSTER);
      if (r.ok || r.reason !== 'NUMBER') wrong.push({ i, bad, r });
      const who = ROSTER[rnd(ROSTER.length)]!.name;
      const named = `${good} Nên hỏi ${who}.`;
      if (validateComment({ comment: named }, allowed, ROSTER).ok) wrong.push({ i, named });
    }
    expect(wrong).toEqual([]);
  });
});

describe('requestSummaryComment voi fetch gia', () => {
  it('thanh cong: luoc do team_summary_comment, than request chi co du lieu tong ket (khong ten); ket qua {text, source: AI}', async () => {
    const d = deps();
    const calls = stubFetch(() => completion({ comment: 'Nhóm có 2 việc quá hạn, nên xử lý sớm.' }));
    const r = await requestSummaryComment(d, INPUT, ROSTER, T);
    expect(r).toEqual({ ok: true, comment: { text: 'Nhóm có 2 việc quá hạn, nên xử lý sớm.', source: 'AI' } });
    expect(calls).toHaveLength(1);
    const body = calls[0]!.body;
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'team_summary_comment', strict: true, schema: COMMENT_JSON_SCHEMA } });
    const msgs = buildCommentMessages(PAYLOAD);
    expect(body.messages).toEqual([
      { role: 'system', content: msgs.system },
      { role: 'user', content: msgs.user },
    ]);
    const sent = JSON.stringify(body);
    for (const m of ROSTER) for (const part of m.name.split(' ')) if (part !== 'Nhóm') expect(sent, part).not.toContain(part);
    expect(d.budget.remaining(T)).toBe(9);
    expect(d.formatModes.get('team_summary_comment')).toBe('json_schema');
  });

  it('nhan xet sai -> bo (ly do cu the); LLM loi -> ly do cua LLM; thieu khoa -> khong goi mang', async () => {
    stubFetch(() => completion({ comment: 'Nhóm có 9 việc quá hạn.' }));
    expect(await requestSummaryComment(deps(), INPUT, ROSTER, T)).toEqual({ ok: false, reason: 'NUMBER' });
    stubFetch(() => completion({ comment: 'Tiến có 2 việc quá hạn.' }));
    expect(await requestSummaryComment(deps(), INPUT, ROSTER, T)).toEqual({ ok: false, reason: 'MEMBER_NAME' });
    stubFetch(() => completion({ text: 'sai khoá' }));
    expect(await requestSummaryComment(deps(), INPUT, ROSTER, T)).toEqual({ ok: false, reason: 'SHAPE' });
    stubFetch(() => json(503, 'ban'));
    expect(await requestSummaryComment(deps(), INPUT, ROSTER, T)).toEqual({ ok: false, reason: 'HTTP_5XX' });
    const none = forbidFetch();
    expect(await requestSummaryComment(deps({ apiKey: '' }), INPUT, ROSTER, T)).toEqual({ ok: false, reason: 'DISABLED' });
    expect(none).toHaveLength(0);
  });

  it(`nhan xet bi bo TRUOC khi ngan sach can: chi goi khi sau luot nay con >= ${COMMENT_RESERVE} luot`, async () => {
    expect(COMMENT_RESERVE).toBe(3);
    const used = (n: number) => {
      const d = deps();
      for (let i = 0; i < n; i++) d.budget.tryTake(T);
      return d;
    };
    const tight = used(7); // con 3 luot: de danh cho hieu cau hoi
    const calls = forbidFetch();
    expect(await requestSummaryComment(tight, INPUT, ROSTER, T)).toEqual({ ok: false, reason: 'BUDGET' });
    expect(calls).toHaveLength(0);
    expect(tight.budget.remaining(T)).toBe(3);

    const enough = used(6); // con 4 luot
    const ok = stubFetch(() => completion({ comment: 'Nhóm có 2 việc quá hạn.' }));
    expect((await requestSummaryComment(enough, INPUT, ROSTER, T)).ok).toBe(true);
    expect(ok).toHaveLength(1);
    expect(enough.budget.remaining(T)).toBe(3);
  });
});
