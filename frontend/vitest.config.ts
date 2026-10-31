import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Cau hinh rieng cho unit test (vitest dung ban vite cua no, khac vite 8 cua
// app, nen tach file de khong lam roi tsc cua `npm run build`).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Do do bao phu ma nguon ung dung (npm run test:coverage)
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts', 'src/types/**'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
