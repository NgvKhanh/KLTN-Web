// Phase 3 - bộ lập kế hoạch Board Patch (một lượt gọi LLM, KHÔNG công cụ) và các rào cấu trúc của mã nguồn Board Patch.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPlannerContext, buildPlannerMessages, makePatchPlanner, PATCH_FORMAT } from '../src/modules/chat/v2/actions/actions.patch.context';
import { PATCH_LIMITS } from '../src/modules/chat/v2/actions/actions.patch.schema';
import { ACTION_MODEL_SCHEMAS, modelTools, PATCH_TOOL, proposeBoardPatchTool, plannerSchemaWithActions } from '../src/modules/chat/v2/chat.v2.registry';

const cfg = (suffix: string) => ({ baseUrl: `https://mock-${suffix}.invalid/v1`, apiKey: 'test-secret-key', model: 'test-model', timeoutMs: 500 });
const okBody = (content: unknown, usage = { prompt_tokens: 120, completion_tokens: 40 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage }));
const messages = buildPlannerMessages('Bổ sung việc cho giai đoạn kiểm thử', buildPlannerContext('Dự án Alpha', { lists: [{ id: 'list-secret-1', name: 'Cần làm' }], cards: [{ listId: 'list-secret-1', title: 'Login UI' }] }));
afterEach(() => vi.unstubAllGlobals());

describe('makePatchPlanner: một lượt gọi LLM theo lược đồ đóng, không công cụ', () => {
  it('gửi response_format json_schema (strict, additionalProperties=false), KHÔNG có tools, KHÔNG lộ khóa API; đọc bản nháp + token + độ trễ', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okBody({ lists: [{ key: 'kt', name: 'Kiểm thử' }], cards: [{ list: 'kt', title: 'Viết unit test' }], notes: '' }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await makePatchPlanner(cfg('ok'))(messages);
    expect(res).toMatchObject({ ok: true, draft: { lists: [{ key: 'kt', name: 'Kiểm thử' }], cards: [{ list: 'kt', title: 'Viết unit test' }] }, promptTokens: 120, completionTokens: 40 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'board_patch_draft', strict: true } });
    const schema = body.response_format.json_schema.schema;
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false, required: ['lists', 'cards', 'notes'] });
    expect(schema.properties.lists.items).toMatchObject({ additionalProperties: false, required: ['key', 'name'] });
    expect(schema.properties.cards.items).toMatchObject({ additionalProperties: false, required: ['list', 'title'] });
    expect(JSON.stringify(schema)).not.toMatch(/delete|remove|archive|rename|cardId|listId|"id"/i); // lược đồ không có ô nào để xóa / sửa / điền id
    expect(JSON.stringify(body)).not.toContain('test-secret-key');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-secret-key');
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
    expect(JSON.stringify(body)).not.toContain('list-secret-1'); // id thật không bao giờ được gửi
    expect(PATCH_FORMAT.name).toBe('board_patch_draft');
  });

  it('nhà cung cấp không hỗ trợ json_schema (400) → hạ xuống json_object rồi vẫn parse được', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('unsupported', { status: 400 })).mockResolvedValueOnce(okBody({ lists: [], cards: [{ list: 'L1', title: 'Việc A' }], notes: '' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await makePatchPlanner(cfg('ladder'))(messages)).toMatchObject({ ok: true, draft: { cards: [{ title: 'Việc A' }] } });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toEqual({ type: 'json_object' });
  });

  it('khóa lạ (xóa / id) → INVALID; JSON hỏng / HTTP lỗi / hết giờ → FAILED; thiếu cấu hình → UNAVAILABLE và không gọi mạng', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okBody({ lists: [], cards: [], delete: ['L1'] })));
    expect(await makePatchPlanner(cfg('evil'))(messages)).toMatchObject({ ok: false, reason: 'INVALID' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okBody('đây không phải JSON')));
    expect(await makePatchPlanner(cfg('bad'))(messages)).toMatchObject({ ok: false, reason: 'FAILED' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('test-secret-key provider failure', { status: 500 })));
    expect(await makePatchPlanner(cfg('http'))(messages)).toMatchObject({ ok: false, reason: 'FAILED' });
    vi.stubGlobal('fetch', (_url: string, opts: RequestInit) => new Promise((_resolve, reject) => opts.signal!.addEventListener('abort', () => reject(new Error('abort')))));
    expect(await makePatchPlanner({ ...cfg('timeout'), timeoutMs: 20 })(messages)).toMatchObject({ ok: false, reason: 'FAILED' });
    const never = vi.fn();
    vi.stubGlobal('fetch', never);
    expect(await makePatchPlanner({ ...cfg('off'), apiKey: '' })(messages)).toMatchObject({ ok: false, reason: 'UNAVAILABLE' });
    expect(never).not.toHaveBeenCalled();
  });

  it('thông điệp: giới hạn trong prompt khớp hằng số backend (không lệch nhau)', () => {
    expect(messages.system).toContain(`Tối đa ${PATCH_LIMITS.maxLists} cột mới và ${PATCH_LIMITS.maxCards} thẻ mới`);
  });
});

describe('công cụ propose_board_patch trong registry', () => {
  it('chỉ có khóa goal; không nằm trong công cụ ĐỌC; có mặt trong lược đồ dự phòng JSON; schema Zod đóng', () => {
    expect(proposeBoardPatchTool.function.name).toBe(PATCH_TOOL);
    expect(Object.keys(proposeBoardPatchTool.function.parameters.properties)).toEqual(['goal']);
    expect(modelTools.map((t) => t.function.name)).not.toContain(PATCH_TOOL);
    expect(plannerSchemaWithActions.safeParse({ calls: [{ name: PATCH_TOOL, arguments: { goal: 'x' } }] }).success).toBe(true);
    expect(ACTION_MODEL_SCHEMAS[PATCH_TOOL].safeParse({ goal: 'x', extra: 1 }).success).toBe(false);
  });
});

describe('rào cấu trúc của mã nguồn Board Patch', () => {
  const dir = path.join(__dirname, '../src/modules/chat/v2/actions');
  const patchFiles = fs.readdirSync(dir).filter((f) => f.startsWith('actions.patch.') && f.endsWith('.ts'));
  const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

  it('có đủ các tệp mong đợi', () => {
    expect(patchFiles.sort()).toEqual(['actions.patch.build.ts', 'actions.patch.context.ts', 'actions.patch.schema.ts', 'actions.patch.service.ts']);
  });

  it('không tệp Board Patch nào tự ghi CSDL: chỉ đọc (findMany / count); việc ghi nằm trong actions.write (cùng executor Phase 2)', () => {
    for (const f of patchFiles) {
      const src = read(f);
      expect(src, `${f} gọi hàm ghi`).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
      expect(src, `${f} dùng SQL thô`).not.toMatch(/\$(executeRaw|queryRaw|executeRawUnsafe|queryRawUnsafe)/);
      expect(src, `${f} bắt đầu transaction riêng`).not.toContain('$transaction');
    }
  });

  it('không tệp nào ngoài lược đồ gọi mạng, ghép chuỗi vào regex hay ghi console', () => {
    for (const f of patchFiles) {
      const src = read(f);
      if (f !== 'actions.patch.context.ts') expect(src, `${f} gọi mạng`).not.toMatch(/\bfetch\s*\(/);
      expect(src, `${f} dùng RegExp()`).not.toMatch(/\bRegExp\s*\(/);
      expect(src, `${f} có console`).not.toMatch(/\bconsole\./);
    }
  });

  it('thao tác Board Patch sinh ra chỉ là CREATE_LIST / CREATE_CARD (build + service không nhắc loại thao tác nào khác)', () => {
    const others = ['RENAME_CARD', 'SET_CARD_DUE', 'MOVE_CARD', 'SET_CARD_STATUS', 'ASSIGN_MEMBER', 'ADD_LABEL'];
    for (const f of ['actions.patch.build.ts', 'actions.patch.context.ts', 'actions.patch.service.ts']) {
      const src = read(f);
      for (const t of others) expect(src, `${f} nhắc ${t}`).not.toContain(t);
    }
  });

  it('executor + write: khóa bảng và kiểm trùng chỉ chạy cho kế hoạch PATCH (kế hoạch thường không đổi hành vi)', () => {
    const write = fs.readFileSync(path.join(dir, 'actions.write.ts'), 'utf8');
    expect(write).toContain('ctx.patch === true');
    expect(write).toContain('FOR UPDATE');
    const exec = fs.readFileSync(path.join(dir, 'actions.executor.ts'), 'utf8');
    expect(exec).toContain("stored.kind === 'PATCH'");
  });
});
