import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'packages/*/test/**/*.test.ts',
            'apps/client/src/**/*.test.{ts,tsx}',
            'apps/server/test/unit/**/*.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'edge',
          include: ['apps/server/test/edge/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['apps/server/test/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30000,
          hookTimeout: 60000,
          fileParallelism: false,
        },
      },
    ],
  },
});
