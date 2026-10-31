import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { loadAndAssertTestDatabaseUrl } from './dbSafety';

/**
 * Chay 1 lan truoc toan bo test:
 *  1) Tao database test neu chua co
 *  2) Ap dung toan bo migration (`prisma migrate deploy`)
 *
 * Yeu cau: Postgres dang chay (localhost:5432, tu `docker compose up -d`).
 */
export default async function setup() {
  // Nem loi ngay neu DATABASE_URL khong ro rang la 1 DB test cuc bo - ham nay
  // co the DROP DATABASE ben duoi (khi migrate deploy that bai).
  const { url: testUrl, dbName: testDb } = loadAndAssertTestDatabaseUrl();

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';

  async function ensureDatabase(recreate = false) {
    const client = new Client({ connectionString: adminUrl.toString() });
    await client.connect();
    if (recreate) {
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [testDb]
      );
      await client.query(`DROP DATABASE IF EXISTS "${testDb}"`);
    }
    const exists = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [testDb]
    );
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${testDb}"`);
    }
    await client.end();
  }

  const deploy = () =>
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: testUrl },
    });

  await ensureDatabase();
  try {
    deploy();
  } catch {
    // DB test co the dang o trang thai migration loi -> tao lai roi thu lai 1 lan
    await ensureDatabase(true);
    deploy();
  }
}
