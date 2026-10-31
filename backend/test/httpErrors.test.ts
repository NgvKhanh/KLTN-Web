// REVIEW 14/10: loi do client gui khong duoc tra 500 ("Loi he thong" + [LOI SERVER] trong log).
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { agent, makeDirectUser } from './helpers';

describe('loi do client gui tra 4xx, khong phai 500', () => {
  it('JSON sai cu phap -> 400, thong diep co dinh', async () => {
    const res = await agent()
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Du lieu JSON gui len khong hop le');
  });

  it('body vuot gioi han 1MB -> 413', async () => {
    const res = await agent()
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(1_200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
  });

  it('JSON hop le nhung sai kieu van la 400 cua validate (khong doi)', async () => {
    const res = await agent().post('/api/auth/login').send({ email: 123 });
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});

describe('dang ky trung email', () => {
  it('email cua tai khoan da xoa mem (qua duoc buoc kiem tra, vap rang buoc duy nhat) -> 409, khong phai 500', async () => {
    const old = await makeDirectUser('Nguoi cu');
    await prisma.user.update({ where: { id: old.id }, data: { deletedAt: new Date() } });
    const res = await agent()
      .post('/api/auth/register')
      .send({ email: old.email, password: 'Password123', name: 'Nguoi moi' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Email nay da duoc su dung');
  });

  it('hai yeu cau dang ky cung email dong thoi -> mot 201, mot 409 (khong co 500)', async () => {
    const email = `race_${Date.now()}@test.local`;
    const send = () => agent().post('/api/auth/register').send({ email, password: 'Password123', name: 'Dua nhau' });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });
});
