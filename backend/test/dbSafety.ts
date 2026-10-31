import { config as loadEnv } from 'dotenv';

/**
 * Kiem tra 1 DATABASE_URL co "trong nhu" DB test cuc bo khong. Tach rieng
 * (khong dong toi dotenv/process.env) de test truc tiep duoc ma khong can
 * gia lap file .env.test.
 *
 * Chi chap nhan host localhost/127.0.0.1 VA ten database co chua tu "test".
 * Hai dieu kien nay la "belt and suspenders": dung TRUOC moi thao tac pha
 * huy du lieu (TRUNCATE / DROP DATABASE) trong bo test, de mot DATABASE_URL
 * cau hinh sai (vd tro toi DB that) khong the lam bo test xoa nham du lieu.
 */
export function assertSafeTestDatabaseUrl(raw: string): {
  url: string;
  dbName: string;
} {
  const url = new URL(raw);
  const dbName = decodeURIComponent(url.pathname.slice(1));

  const looksLikeTestHost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const looksLikeTestDbName = /(^|[_-])test([_-]|$)/i.test(dbName);

  if (!looksLikeTestHost || !looksLikeTestDbName) {
    throw new Error(
      'DATABASE_URL trong khong an toan de chay test ' +
        `(host="${url.hostname}", database="${dbName}"). Bo test co the ` +
        'TRUNCATE moi bang (truoc moi test) va DROP DATABASE (khi migrate ' +
        'that bai) tren gia tri nay, nen chi chap nhan host localhost/127.0.0.1 ' +
        'va ten database co chua tu "test". Hay sua DATABASE_URL trong ' +
        '.env.test, vi du "...localhost:5432/taskflow_test".'
    );
  }

  return { url: raw, dbName };
}

/**
 * Nap `.env.test` va TRA VE DATABASE_URL, nhung chi sau khi kiem tra ky -
 * dung TRUOC moi thao tac pha huy du lieu (TRUNCATE / DROP DATABASE) trong
 * bo test. Nem loi ngay (dung ca bo test) neu:
 *
 *  - Khong doc duoc file .env.test (dotenv tra ve `error`). Neu bo qua loi
 *    nay, code phia sau se tiep tuc chay voi bat ky DATABASE_URL nao con sot
 *    lai trong moi truong xung quanh - co the la mot database THAT.
 *  - DATABASE_URL khong qua duoc assertSafeTestDatabaseUrl() o tren.
 */
export function loadAndAssertTestDatabaseUrl(): {
  url: string;
  dbName: string;
} {
  const result = loadEnv({ path: '.env.test', override: true });
  if (result.error) {
    throw new Error(
      `Khong doc duoc backend/.env.test: ${result.error.message}\n` +
        'Dung lai o day thay vi chay tiep voi DATABASE_URL con sot lai trong ' +
        'moi truong xung quanh - gia tri do co the tro toi mot database THAT ' +
        'va bi bo test TRUNCATE/DROP nham vao.'
    );
  }

  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('Thieu DATABASE_URL trong backend/.env.test');
  }

  return assertSafeTestDatabaseUrl(raw);
}
