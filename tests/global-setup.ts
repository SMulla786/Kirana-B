import {execSync} from 'node:child_process';
import {assertTestDatabase} from './test-env';

export default function setup() {
    const url = assertTestDatabase();
    // Migrations are gitignored (P-006), so sync the schema directly. --accept-data-loss is
    // safe only because assertTestDatabase pins us to a *_test database.
    execSync('npx prisma db push --skip-generate --accept-data-loss', {
        stdio: 'inherit',
        env: {...process.env, DATABASE_URL: url},
    });
}
