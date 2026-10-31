import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardPlan } from '../../types/ai';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../axios', () => ({ api: { get: mocks.get, post: mocks.post } }));

import { applyBoardPlan, extractDocument, fetchAiStatus, generateBoardPlan } from './ai';

// Lop goi API cua module AI: dung DUONG DAN, dung THAN yeu cau, boc/tra du lieu dung tang
// (`res.data.data`). Cac test giao dien mock lop nay nen day la cho DUY NHAT kiem tra no.

beforeEach(() => {
  vi.resetAllMocks();
});

describe('lib/api/ai', () => {
  it('fetchAiStatus: GET /ai/status, tra data.data', async () => {
    const status = { llmAvailable: true, provider: 'google-gemini', model: 'gemini-3.8-flash' };
    mocks.get.mockResolvedValue({ data: { data: status } });
    await expect(fetchAiStatus()).resolves.toEqual(status);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/ai/status');
  });

  it('extractDocument: POST /ai/documents/extract với FormData trường "file" (không tự đặt Content-Type để axios thêm boundary), tra data.data', async () => {
    const doc = { inputKind: 'DOCX', text: 'Xin chào', chars: 8, truncated: false, pages: null };
    mocks.post.mockResolvedValue({ data: { data: doc } });
    const file = new File(['noi dung'], 'ke-hoach.docx');

    await expect(extractDocument(file)).resolves.toEqual(doc);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    const [url, body, ...rest] = mocks.post.mock.calls[0]!;
    expect(url).toBe('/ai/documents/extract');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBeInstanceOf(File);
    expect(((body as FormData).get('file') as File).name).toBe('ke-hoach.docx');
    expect(Array.from((body as FormData).keys())).toEqual(['file']);
    expect(rest).toEqual([]); // không có cấu hình thứ 3 (đặc biệt là headers Content-Type tự đặt)
  });

  it('generateBoardPlan: POST /ai/board-plans với đúng dữ liệu, tra data.data (không lọc/không đổi tên khoá)', async () => {
    const result = { runId: 'r1', llmUsed: false, modeAuto: 'STRUCTURED', plan: {}, stats: {} };
    mocks.post.mockResolvedValue({ data: { data: result } });
    const input = { workspaceId: 'ws1', text: 'x'.repeat(30), inputKind: 'PDF' as const, mode: 'FREEFORM' as const, projectStart: '2026-11-01', projectEnd: '2026-11-30', skipWeekend: false };

    await expect(generateBoardPlan(input)).resolves.toEqual(result);
    expect(mocks.post).toHaveBeenCalledWith('/ai/board-plans', input);
  });

  it('applyBoardPlan: POST /ai/board-plans/:runId/apply với { plan }, mã run được mã hoá URL, tra data.data.board', async () => {
    const board = { id: 'b1', name: 'Bảng' };
    mocks.post.mockResolvedValue({ data: { data: { board } } });
    const plan = { mode: 'STRUCTURED', board: { name: 'Bảng', color: '#0079BF' }, labels: [], lists: [], warnings: [], assumptions: [] } as BoardPlan;

    await expect(applyBoardPlan('run-1', plan)).resolves.toEqual(board);
    expect(mocks.post).toHaveBeenCalledWith('/ai/board-plans/run-1/apply', { plan });

    await applyBoardPlan('a/b?c', plan);
    expect(mocks.post).toHaveBeenLastCalledWith('/ai/board-plans/a%2Fb%3Fc/apply', { plan });
  });
});
