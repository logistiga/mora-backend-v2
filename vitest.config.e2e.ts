import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup.ts'],
    // e2e specs each boot a full Nest app against the SAME external
    // Postgres/Redis/BullMQ; running spec files concurrently was observed to
    // starve background job processing enough to make waitFor()-based
    // assertions flaky. Sequential execution matches how these tests are
    // meant to be run (against shared real infra) and removes the flakiness.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
