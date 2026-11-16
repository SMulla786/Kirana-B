import {existsSync, readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';

// CI sets TEST_DATABASE_URL. Locally, reuse .env's server with the database swapped to kirana_test;
// only DATABASE_URL is read, so no other .env secret reaches the tests.
const testDatabaseUrl = (): string | undefined => {
    if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
    if (!existsSync('.env')) return undefined;
    const devUrl = parseEnv(readFileSync('.env', 'utf8')).DATABASE_URL;
    if (!devUrl) return undefined;
    const url = new URL(devUrl);
    url.pathname = '/kirana_test';
    return url.toString();
};

// Non-secret values, so config.ts validates without any real secret.
export const testEnv: Record<string, string> = {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret',
    JWT_ACCESS_EXPIRATION_MINUTES: '15',
    JWT_REFRESH_EXPIRATION_DAYS: '30',
    EMAIL_FROM: 'test@example.com',
    APP_URL: 'http://localhost:5173',
    AUTH_RATE_LIMIT_MAX: '1000',
};
const databaseUrl = testDatabaseUrl();
if (databaseUrl) testEnv.DATABASE_URL = databaseUrl;

// Without DATABASE_URL, Prisma would fall back to .env (the dev DB), so refuse instead.
export const assertTestDatabase = (url = testEnv.DATABASE_URL): string => {
    if (!url) throw new Error('No test database: set TEST_DATABASE_URL, or DATABASE_URL in .env.');
    const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
    if (!dbName.endsWith('_test')) {
        throw new Error(`Refusing to run tests against "${dbName}": the name must end in _test.`);
    }
    return url;
};
