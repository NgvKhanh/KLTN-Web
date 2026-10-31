import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import {
  aiApplyLimiter,
  aiGenerateLimiter,
} from '../src/middleware/rateLimit.middleware';
import { makeBoard, makeUser } from './helpers';

// Buoc 1 (AI_MODULE.md §11): nen du lieu + cau hinh cho module AI.
// Chua co endpoint nao - test chi khoa 3 thu: (1) AiRun khong mat khi xoa
// user/bang/khong gian, (2) cau hinh env.ai dung, (3) limiter tinh theo user.

/** Tao 1 AiRun toi thieu (chi cac cot bat buoc) gan voi user/bang/khong gian. */
async function makeRun(over: {
  userId: string | null;
  workspaceId: string | null;
  boardId: string | null;
  actorKey: string;
}) {
  return prisma.aiRun.create({
    data: {
      ...over,
      inputText: 'Lam bao cao thang 10',
      inputChars: 20,
      inputLines: 1,
      modeAuto: 'FREEFORM',
      mode: 'FREEFORM',
      structuredRatio: 0,
      plan: { lists: [] },
    },
  });
}

describe('AiRun: so lieu do dac khong bi mat khi xoa quan he (SetNull, khong Cascade)', () => {
  it('ca 3 khoa ngoai trong DB that deu la ON DELETE SET NULL', async () => {
    // Doc thang tu pg_constraint cua DB test (dung bang migration that da
    // duoc globalSetup ap) -> bat loi neu migration viet sai so voi schema.
    // confdeltype: 'n' = SET NULL, 'c' = CASCADE, 'a' = NO ACTION.
    const rows = await prisma.$queryRaw<{ conname: string; confdeltype: string }[]>`
      SELECT conname, confdeltype::text AS confdeltype
      FROM pg_constraint
      WHERE conrelid = '"AiRun"'::regclass AND contype = 'f'
      ORDER BY conname`;
    expect(rows.map((r) => r.conname)).toEqual([
      'AiRun_boardId_fkey',
      'AiRun_userId_fkey',
      'AiRun_workspaceId_fkey',
    ]);
    for (const r of rows) expect(r.confdeltype).toBe('n');
  });

  it('xoa bang -> boardId ve null, van giu userId/workspaceId', async () => {
    const user = await makeUser();
    const board = await makeBoard(user, { name: 'Bang AI' });
    const run = await makeRun({
      userId: user.id,
      workspaceId: user.personalWorkspaceId,
      boardId: board.id,
      actorKey: user.id,
    });

    await prisma.board.delete({ where: { id: board.id } });

    const after = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.boardId).toBeNull();
    expect(after.userId).toBe(user.id);
    expect(after.workspaceId).toBe(user.personalWorkspaceId);
  });

  it('xoa user -> dong AiRun VAN CON, userId/workspaceId/boardId ve null, actorKey con nguyen', async () => {
    const user = await makeUser();
    const board = await makeBoard(user, { name: 'Bang AI 2' });
    const run = await makeRun({
      userId: user.id,
      workspaceId: user.personalWorkspaceId,
      boardId: board.id,
      actorKey: user.id,
    });

    // Xoa user keo theo (Cascade) khong gian ca nhan + bang cua ho - nhung
    // AiRun khong duoc bi keo theo.
    await prisma.user.delete({ where: { id: user.id } });

    const after = await prisma.aiRun.findUnique({ where: { id: run.id } });
    expect(after).not.toBeNull();
    expect(after!.userId).toBeNull();
    expect(after!.workspaceId).toBeNull();
    expect(after!.boardId).toBeNull();
    // actorKey khong co khoa ngoai -> van gom nhom duoc theo nguoi da bi xoa
    expect(after!.actorKey).toBe(user.id);
    expect(after!.inputText).toBe('Lam bao cao thang 10');
  });
});

describe('env.ai: cau hinh module AI', () => {
  // env.ts doc process.env LUC IMPORT -> moi ca phai nap lai module. Ghi de bang
  // chuoi rong (khong phai xoa) vi dotenv khong ghi de bien da ton tai, nen ca
  // test khong phu thuoc vao viec file backend/.env co dien key that hay khong.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadEnv() {
    vi.resetModules();
    return (await import('../src/config/env')).env;
  }

  it('de trong het -> gia tri rong / mac dinh, KHONG nem loi (server van khoi dong)', async () => {
    for (const key of [
      'AI_BASE_URL',
      'AI_API_KEY',
      'AI_MODEL',
      'AI_PROVIDER_LABEL',
      'AI_TIMEOUT_MS',
      'AI_MAX_INPUT_CHARS',
    ]) {
      vi.stubEnv(key, '');
    }
    const { ai } = await loadEnv();
    expect(ai.baseUrl).toBe('');
    expect(ai.apiKey).toBe('');
    expect(ai.model).toBe('');
    expect(ai.providerLabel).toBe('openai-compatible');
    expect(ai.timeoutMs).toBe(30000);
    expect(ai.maxInputChars).toBe(20000);
  });

  it('doc dung gia tri va bo dau / cuoi cua baseUrl', async () => {
    vi.stubEnv('AI_BASE_URL', 'https://api.example.test/v1///');
    vi.stubEnv('AI_API_KEY', 'khoa-bi-mat');
    vi.stubEnv('AI_MODEL', 'mo-hinh-x');
    vi.stubEnv('AI_TIMEOUT_MS', '12345');
    vi.stubEnv('AI_MAX_INPUT_CHARS', '999');
    const { ai } = await loadEnv();
    expect(ai.baseUrl).toBe('https://api.example.test/v1');
    expect(ai.apiKey).toBe('khoa-bi-mat');
    expect(ai.model).toBe('mo-hinh-x');
    expect(ai.timeoutMs).toBe(12345);
    expect(ai.maxInputChars).toBe(999);
  });

  it.each(['abc', '0', '-5', '1.5'])(
    'AI_TIMEOUT_MS = "%s" (khong phai so nguyen duong) -> nem loi ro rang luc khoi dong',
    async (bad) => {
      vi.stubEnv('AI_TIMEOUT_MS', bad);
      await expect(loadEnv()).rejects.toThrow(/AI_TIMEOUT_MS/);
    }
  );
});

describe('limiter cua module AI tinh theo NGUOI DUNG (khong theo IP)', () => {
  /** App nho: gan req.user tu header (thay cho requireAuth) roi qua limiter. */
  function makeApp(limiter: express.RequestHandler) {
    const app = express();
    app.use((req, _res, next) => {
      req.user = {
        id: String(req.header('x-test-user')),
        email: '',
        name: '',
        avatarUrl: null,
      };
      next();
    });
    app.post('/x', limiter, (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it('aiGenerateLimiter: user A dung het 10 luot bi 429, user B (cung IP) van goi duoc', async () => {
    const app = makeApp(aiGenerateLimiter);
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).post('/x').set('x-test-user', 'user-A');
      expect(res.status).toBe(200);
    }
    const blocked = await request(app).post('/x').set('x-test-user', 'user-A');
    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);

    // Cung 127.0.0.1 nhung khac user -> bo dem rieng
    const other = await request(app).post('/x').set('x-test-user', 'user-B');
    expect(other.status).toBe(200);
  });

  it('aiApplyLimiter: cho 30 luot, luot 31 bi 429; user khac khong bi anh huong', async () => {
    const app = makeApp(aiApplyLimiter);
    for (let i = 0; i < 30; i += 1) {
      const res = await request(app).post('/x').set('x-test-user', 'user-C');
      expect(res.status).toBe(200);
    }
    expect((await request(app).post('/x').set('x-test-user', 'user-C')).status).toBe(429);
    expect((await request(app).post('/x').set('x-test-user', 'user-D')).status).toBe(200);
  });
});
