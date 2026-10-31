// Do du lieu mo phong cho module goi y phan cong vao CSDL dang cau hinh (mac dinh la DB dev).
// CHAY TAY, khong nam trong bo test:
//
//   npm run seed:sim                  don ban cu (neu co) roi tao lai
//   npm run seed:sim -- --seed=7      hat giong khac -> bo du lieu khac
//   npm run seed:sim -- --remove      chi xoa du lieu mo phong, khong tao moi
//
// AN TOAN: chi dong toi tai khoan @sim.local va thu ho so huu (xem simSeed.ts). Tu choi chay khi
// NODE_ENV=production. Chay tren host: DATABASE_URL trong backend/.env tro toi localhost:5432.

import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { DEFAULT_SIM, generateSimulation, summarize } from './simGenerator';
import {
  removeSimulation,
  seedSimulation,
  SIM_DEFAULT_PASSWORD,
  SIM_EMAIL_DOMAIN,
  vnToday,
} from './simSeed';

function fail(message: string): never {
  console.error(`Loi: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let seed = DEFAULT_SIM.seed;
  let removeOnly = false;
  for (const arg of argv) {
    if (arg === '--remove') removeOnly = true;
    else if (arg.startsWith('--seed=')) {
      seed = Number(arg.slice('--seed='.length));
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
        fail('--seed phai la so nguyen tu 0 den 4294967295');
      }
    } else fail(`tham so la "${arg}" (chi co --seed=N va --remove)`);
  }
  return { seed, removeOnly };
}

/** Chuoi ket noi da che mat khau, de in ra cho nguoi dung thay minh dang ghi vao DB nao. */
function describeDatabase(): string {
  try {
    const url = new URL(env.databaseUrl);
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    return '(khong doc duoc DATABASE_URL)';
  }
}

async function main() {
  if (env.isProduction) fail('khong chay o NODE_ENV=production');
  const { seed, removeOnly } = parseArgs(process.argv.slice(2));

  console.log(`CSDL dich: ${describeDatabase()}`);

  if (removeOnly) {
    const removed = await removeSimulation(prisma);
    console.log(`Da xoa ${removed.users} tai khoan mo phong va ${removed.workspaces} khong gian cua ho.`);
    return;
  }

  const data = generateSimulation({ ...DEFAULT_SIM, seed });
  const sum = summarize(data);
  const result = await seedSimulation(prisma, data, { today: vnToday() });

  console.log(
    result.removed.users > 0
      ? `Da don ban cu: ${result.removed.users} tai khoan, ${result.removed.workspaces} khong gian.`
      : 'Chua co du lieu mo phong cu.'
  );
  console.log(
    `Da tao: ${result.counts.users} nguoi, ${result.counts.boards} bang, ${result.counts.cards} the, ` +
      `${result.counts.activities} dong nhat ky (hat giong ${seed}).`
  );
  console.log(
    `Thong ke: ${sum.open} the dang mo; dung han ${(sum.onTimeRate * 100).toFixed(0)}%; ` +
      `bi mo lai ${(sum.reopenedRate * 100).toFixed(0)}%; the mo ho ${(sum.ambiguousRate * 100).toFixed(0)}%; ` +
      `phan cong lich su trung nguoi gioi nhat ${(sum.optimalAssignRate * 100).toFixed(0)}%.`
  );
  console.log(`\nDang nhap thu voi chu nhom: ${data.people[0]!.email}  /  mat khau: ${SIM_DEFAULT_PASSWORD}`);
  console.log(`(moi tai khoan mo phong deu co duoi @${SIM_EMAIL_DOMAIN}, xoa bang: npm run seed:sim -- --remove)`);
}

main()
  .catch((err) => {
    console.error('Do du lieu that bai:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
