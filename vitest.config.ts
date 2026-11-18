import path from 'node:path';
import {defineConfig} from 'vitest/config';
import {testEnv} from './tests/test-env';

const src = path.resolve(__dirname, 'src');

export default defineConfig({
    resolve: {
        // Mirrors tsconfig "paths".
        alias: [
            {
                find: /^@(libs|utils|config|routes|models|services|controllers|middlewares|validations)\//,
                replacement: `${src}/$1/`,
            },
            {find: /^client$/, replacement: `${src}/client.ts`},
        ],
    },
    test: {
        include: ['tests/**/*.test.ts'],
        env: testEnv,
        globalSetup: ['tests/global-setup.ts'],
        fileParallelism: false, // all files share one test DB
        // Integration tests hash passwords and hit a real DB; 5 s fails on a busy PC or CI runner.
        testTimeout: 20_000,
    },
});
