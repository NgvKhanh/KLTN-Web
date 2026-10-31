// REVIEW 14/10: backend khong co bo header an toan va nhan form-urlencoded o moi route JSON.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AVATAR_DIR } from '../src/config/upload';
import { agent } from './helpers';

const created: string[] = [];
afterAll(() => {
  for (const f of created) fs.rmSync(f, { force: true });
});

describe('header an toan', () => {
  it('API: khong lo X-Powered-By, co nosniff / chong nhung khung / chinh sach tham chieu', async () => {
    const res = await agent().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toBe("default-src 'none';frame-ancestors 'none'");
    // HSTS chi bat o production (qua HTTPS)
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('tep tinh (anh dai dien) van nhung duoc tu nguon khac: Cross-Origin-Resource-Policy = cross-origin', async () => {
    const name = `review-${Date.now()}.png`;
    const file = path.join(AVATAR_DIR, name);
    // 1x1 PNG
    fs.writeFileSync(
      file,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    );
    created.push(file);
    const res = await agent().get(`/uploads/avatars/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('CORS cua frontend van hoat dong (helmet khong can thiep)', async () => {
    const res = await agent()
      .options('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('body form-urlencoded khong con duoc doc', () => {
  it('dang nhap bang form-post -> 400 (truong thieu), khong phai xu ly nhu JSON', async () => {
    const res = await agent()
      .post('/api/auth/login')
      .type('form')
      .send({ email: 'nobody@example.com', password: 'whatever1' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it('JSON van dung binh thuong', async () => {
    const res = await agent().post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever1' });
    expect(res.status).toBe(401);
  });
});
