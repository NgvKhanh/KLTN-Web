// Do NHOM DEMO 5 nguoi cung lam mot loai viec vao CSDL dang cau hinh (mac dinh la DB dev), de xem phan
// goi y phan cong. CHAY TAY, khong nam trong bo test:
//
//   npm run seed:team             don ban cu (neu co) roi tao lai
//   npm run seed:team -- --remove chi xoa nhom demo, khong tao moi
//
// AN TOAN: chi dong toi tai khoan @team.local va thu ho so huu (xem teamSeed.ts); khong dung toi
// du lieu that va khong dung toi du lieu mo phong @sim.local (npm run seed:sim). Tu choi chay khi
// NODE_ENV=production. Chay tren host: DATABASE_URL trong backend/.env tro toi localhost:5432.

import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { TEAM_BOARDS, TEAM_EMAIL_DOMAIN, TEAM_PASSWORD, TEAM_PEOPLE, TEAM_WORKSPACE_NAME, removeTeam, seedTeam } from './teamSeed';

function fail(message: string): never {
  console.error(`Loi: ${message}`);
  process.exit(1);
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
  const args = process.argv.slice(2);
  for (const arg of args) if (arg !== '--remove') fail(`tham so la "${arg}" (chi co --remove)`);

  console.log(`CSDL dich: ${describeDatabase()}`);

  if (args.includes('--remove')) {
    const removed = await removeTeam(prisma);
    console.log(`Da xoa ${removed.users} tai khoan nhom demo va ${removed.workspaces} khong gian cua ho.`);
    return;
  }

  const result = await seedTeam(prisma);
  console.log(
    result.removed.users > 0
      ? `Da don ban cu: ${result.removed.users} tai khoan, ${result.removed.workspaces} khong gian.`
      : 'Chua co nhom demo cu.'
  );
  const c = result.counts;
  console.log(
    `Da tao khong gian "${TEAM_WORKSPACE_NAME}": ${c.users} nguoi, ${c.boards} bang, ${c.cards} the ` +
      `(${c.done} da xong, ${c.open} dang mo da giao, ${c.unassigned} chua giao de thu goi y).`
  );

  console.log(`\nTai khoan (mat khau chung: ${TEAM_PASSWORD}):`);
  for (const p of TEAM_PEOPLE) console.log(`  ${p.email.padEnd(20)} ${p.name.padEnd(20)} ${p.role}`);
  console.log(`\nMo bang "${TEAM_BOARDS[TEAM_BOARDS.length - 1]!.name}" -> cot "Can lam": co ${c.unassigned} the chua giao.`);
  console.log('Mo 1 the -> muc "Thanh vien" de xem goi y; menu cot "Can lam" -> "Chia viec goi y" de chia ca danh sach.');
  console.log(`(moi tai khoan nhom demo co duoi @${TEAM_EMAIL_DOMAIN}, xoa bang: npm run seed:team -- --remove)`);
}

main()
  .catch((err) => {
    console.error('Do du lieu that bai:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
