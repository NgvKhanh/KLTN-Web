// PHAI la hai import dau tien: tro thu muc tai len sang thu muc tam (khong dung vao tep that cua nguoi dung) va chan khoa AI that
// trong backend/.env truoc khi env.ts / upload.ts duoc nap
import './uploadsIsolation';
import './aiEnvIsolation';
import { loadAndAssertTestDatabaseUrl } from './dbSafety';

// Nap + kiem tra DATABASE_URL TRUOC khi bat ky module nao doc process.env
// (nhat la src/config/env.ts). Nem loi ngay neu khong ro rang la DB test cuc
// bo - beforeEach ben duoi se TRUNCATE moi bang tren gia tri nay.
loadAndAssertTestDatabaseUrl();

import { afterAll, beforeEach, vi } from 'vitest';

// Khong gui email that trong test (env.ts co cau hinh Gmail that)
vi.mock('../src/config/mailer', () => ({
  sendMail: vi.fn().mockResolvedValue({ previewUrl: null }),
  verifyMailer: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../src/config/prisma';

// Xoa sach du lieu truoc moi test de cac test doc lap voi nhau
beforeEach(async () => {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${list} RESTART IDENTITY CASCADE`
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
