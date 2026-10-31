// Setup cho nhom test THUAN (*.unit.test.ts): ham thuan / logic khong cham CSDL.
//
// Khac setup.ts: KHONG TRUNCATE 44 bang truoc moi test (do la ~0,5 s moi test, ke ca test ham thuan - ca bo test
// backend mat ~31 phut chu yeu vi viec do) va KHONG can globalSetup (tao DB, migrate). Doi lai, Prisma bi thay
// bang ban "cam": test thuan ma lo goi vao CSDL se that bai ngay voi thong bao ro, de chuyen no sang nhom tich hop
// (dat ten *.test.ts, khong co .unit).
//
// Van giu cac lop bao ve cua setup.ts: thu muc upload tam, khoa AI that bi chan, DATABASE_URL phai la DB test.
import './uploadsIsolation';
import './aiEnvIsolation';
import { loadAndAssertTestDatabaseUrl } from './dbSafety';

loadAndAssertTestDatabaseUrl();

import { vi } from 'vitest';

// Khong gui email that trong test
vi.mock('../src/config/mailer', () => ({
  sendMail: vi.fn().mockResolvedValue({ previewUrl: null }),
  verifyMailer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/config/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        // Cac thao tac mac dinh cua JS / vitest (in doi tuong, await, so sanh...) khong phai truy van CSDL
        if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON' || prop === 'asymmetricMatch') {
          return undefined;
        }
        if (prop === '$disconnect') return async () => {};
        throw new Error(
          `Test thuan (*.unit.test.ts) cham CSDL: prisma.${prop}. ` +
            'Doi ten tep thanh *.test.ts de chay trong nhom tich hop (co CSDL that), hoac tach phan logic thuan ra.'
        );
      },
    }
  ),
}));
