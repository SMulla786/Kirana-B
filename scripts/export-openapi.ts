import {writeFileSync} from 'node:fs';
import path from 'node:path';

// Dummy, non-secret values so config validation passes without a real .env or database.
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'openapi-export';

// require, not import: imports are hoisted above the env defaults.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {buildOpenApiDocument} = require('../src/docs/openapi');

const file = path.resolve(__dirname, '..', 'openapi.json');
writeFileSync(file, JSON.stringify(buildOpenApiDocument(), null, 2) + '\n');
console.log(`Wrote ${file}`);
