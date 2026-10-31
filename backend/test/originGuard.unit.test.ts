import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, originGuard } from '../src/middleware/originGuard.middleware';
import { AppError } from '../src/utils/AppError';

const FRONTEND = 'https://taskflow.vercel.app';

// App toi gian: chi originGuard + mot route moi phuong thuc, loi AppError -> JSON nhu app that
function makeApp() {
  const app = express();
  app.use(originGuard([FRONTEND, 'http://localhost:5173']));
  app.all('/api/x', (_req, res) => res.json({ success: true }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as AppError;
    res.status(e.statusCode ?? 500).json({ success: false, code: e.code });
  });
  return app;
}

describe('isAllowedOrigin', () => {
  it('khong co Origin (curl, server goi server) hoac Origin trong danh sach -> duoc', () => {
    expect(isAllowedOrigin(undefined, [FRONTEND])).toBe(true);
    expect(isAllowedOrigin(FRONTEND, [FRONTEND])).toBe(true);
  });

  it('Origin la, "null", hoac khac giao thuc / co dau "/" cuoi -> khong duoc', () => {
    expect(isAllowedOrigin('https://trang-la.example', [FRONTEND])).toBe(false);
    expect(isAllowedOrigin('null', [FRONTEND])).toBe(false);
    expect(isAllowedOrigin('http://taskflow.vercel.app', [FRONTEND])).toBe(false);
    expect(isAllowedOrigin(`${FRONTEND}/`, [FRONTEND])).toBe(false);
  });
});

describe('originGuard', () => {
  const app = makeApp();

  it('request GHI tu trang la -> 403 ORIGIN_NOT_ALLOWED (moi phuong thuc ghi)', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(app)[method]('/api/x').set('Origin', 'https://trang-la.example');
      expect(res.status, method).toBe(403);
      expect(res.body.code, method).toBe('ORIGIN_NOT_ALLOWED');
    }
  });

  it('request GHI tu frontend trong danh sach -> cho qua', async () => {
    await request(app).post('/api/x').set('Origin', FRONTEND).expect(200);
    await request(app).delete('/api/x').set('Origin', 'http://localhost:5173').expect(200);
  });

  it('khong co Origin -> cho qua (curl, health check, test)', async () => {
    await request(app).post('/api/x').expect(200);
  });

  it('request DOC (GET / HEAD / OPTIONS) tu trang la -> cho qua, CORS lo phan doc ket qua', async () => {
    await request(app).get('/api/x').set('Origin', 'https://trang-la.example').expect(200);
    await request(app).head('/api/x').set('Origin', 'https://trang-la.example').expect(200);
    await request(app).options('/api/x').set('Origin', 'https://trang-la.example').expect(200);
  });
});
