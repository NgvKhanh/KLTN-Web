import { defineConfig } from 'vitest/config';

/**
 * Hai nhom test (rà soát 14/10, bước 5):
 *
 *  - unit        : test THUẦN, không chạm CSDL. Không globalSetup, không TRUNCATE trước mỗi test (việc đó tốn ~0,5 s
 *                  MỖI test, kể cả test hàm thuần: cả bộ test từng mất ~31 phút chủ yếu vì vậy). Prisma bị thay bằng
 *                  bản "câm" (test/setup.unit.ts): test thuần mà lỡ chạm CSDL sẽ thất bại ngay với thông báo rõ.
 *                  Gồm: *.unit.test.ts (quy ước cho test mới) + UNIT_FILES (test cũ đã phân loại bằng cách chạy thử
 *                  với Prisma "câm": tệp nào qua hết thì vào đây).
 *  - integration : còn lại - HTTP thật + PostgreSQL thật (taskflow_test), chạy tuần tự, TRUNCATE trước mỗi test.
 *
 * Test MỚI mặc định vào nhóm tích hợp (an toàn). Viết test thuần thì đặt tên *.unit.test.ts.
 * Chạy: `npm test` (cả hai), `npm run test:unit`, `npm run test:integration`, `npm run test:coverage`.
 */
const UNIT_FILES = [
  'ai.build',
  'ai.dataset',
  'ai.document',
  'ai.isolation',
  'ai.plan',
  'ai.rules',
  'ai.schedule',
  'assign.declared',
  'assign.evalarms',
  'assign.evalcache',
  'assign.evalexperiments',
  'assign.evalleader',
  'assign.evalplanarms',
  'assign.evalplanbatches',
  'assign.evalplandeclared',
  'assign.evalplanreport',
  'assign.evalplanrun',
  'assign.evalreport',
  'assign.evalrun',
  'assign.evalstats',
  'assign.evalsweeps',
  'assign.learn',
  'assign.plan',
  'assign.profile',
  'assign.score',
  'assign.sim',
  'assign.simdeclared',
  'assign.snapshot',
  'assign.text',
  'assign.tfidf',
  'assign.weights',
  'chat.actions.eval',
  'chat.actions.multi.pure',
  'chat.actions.pure',
  'chat.answer',
  'chat.answer.check',
  'chat.catalog.answer',
  'chat.catalog.resolve',
  'chat.checklist.pure',
  'chat.cleanup.pure',
  'chat.edit.pure',
  'chat.entities',
  'chat.followup',
  'chat.guard',
  'chat.intent',
  'chat.llm',
  'chat.members',
  'chat.patch.planner',
  'chat.patch.pure',
  'chat.period',
  'chat.rules',
  'chat.session',
  'chat.summary',
  'chat.v2.llm',
  'dbSafety',
  'recurringSchedule.dates',
  'uploads.isolation',
].map((name) => `test/${name}.test.ts`);

const UNIT_INCLUDE = ['test/**/*.unit.test.ts', ...UNIT_FILES];

const COMMON = {
  environment: 'node' as const,
  hookTimeout: 30_000,
  testTimeout: 20_000,
};

export default defineConfig({
  test: {
    // Cac tep tich hop dung chung 1 DB (truncate giua moi test) -> chay tuan tu. Dat o goc de chac chan ap dung
    // (mot so tuy chon khong ho tro rieng tung project); nhom unit nhanh nen chay tuan tu cung khong dang ke.
    fileParallelism: false,
    projects: [
      {
        test: {
          ...COMMON,
          name: 'unit',
          include: UNIT_INCLUDE,
          setupFiles: ['./test/setup.unit.ts'],
        },
      },
      {
        test: {
          ...COMMON,
          name: 'integration',
          include: ['test/**/*.test.ts'],
          exclude: ['node_modules/**', ...UNIT_INCLUDE],
          globalSetup: ['./test/globalSetup.ts'],
          setupFiles: ['./test/setup.ts'],
        },
      },
    ],
    // Do do bao phu ma nguon ung dung (khong tinh ma sinh tu Prisma, script danh gia / seed, diem vao server)
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/scripts/**', 'src/server.ts', 'src/types/**'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
