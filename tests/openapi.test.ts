import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import app from '../src/app';
import {buildOpenApiDocument} from '../src/docs/openapi';
import {api} from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Layer = {route?: any; handle: any; matchers?: ((p: string) => unknown)[]};
const stackOf = (layer: Layer): Layer[] => layer.handle?.stack ?? [];
const matches = (layer: Layer, p: string) => !!layer.matchers?.some((m) => m(p));

// Express 5 keeps no mount path, so prefixes are recovered by probing the known mounts.
const MOUNTS = ['/api/v1', '/auth', '/business', '/catalog', '/customers', '/pos', '/admin'];

const collect = (layers: Layer[], prefix: string, out: string[]) => {
    for (const layer of layers) {
        if (layer.route) {
            for (const method of Object.keys(layer.route.methods)) {
                out.push(`${method} ${prefix}${layer.route.path}`);
            }
        } else if (stackOf(layer).length) {
            const mount = MOUNTS.find((m) => matches(layer, m) && !matches(layer, '/zzz'));
            if (mount) collect(stackOf(layer), prefix + mount, out);
        }
    }
};

const mountedRoutes = () => {
    const out: string[] = [];
    for (const layer of (app as any).router.stack as Layer[]) {
        if (layer.route) collect([layer], '', out);
        // The root-mounted swagger router matches everything, so it is skipped.
        else if (matches(layer, '/api/v1') && !matches(layer, '/zzz')) {
            collect(stackOf(layer), '/api/v1', out);
        }
    }
    return out;
};

describe('OpenAPI document', () => {
    const doc = buildOpenApiDocument();

    it('builds an OpenAPI 3 document', () => {
        expect(doc.openapi).toMatch(/^3\./);
        expect(doc.info.title).toBe('KiranaOS API');
        expect(doc.servers).toEqual([{url: '/api/v1'}]);
    });

    it('documents every mounted route', () => {
        const routes = mountedRoutes().filter((r) => r !== 'get /');
        expect(routes.length).toBeGreaterThan(25);
        for (const r of routes) {
            const [method, rawPath] = r.split(' ');
            const p = rawPath
                .replace(/^\/api\/v1/, '')
                .replace(/(.)\/$/, '$1')
                .replace(/:(\w+)/g, '{$1}');
            expect((doc.paths as any)[p]?.[method], r).toBeDefined();
        }
    });

    it('serves the document at /api-docs/openapi.json', async () => {
        const res = await api.get('/api-docs/openapi.json');
        expect(res.status).toBe(200);
        expect(res.body.openapi).toMatch(/^3\./);
    });

    it('matches the committed openapi.json (run npm run openapi:export)', () => {
        const file = path.resolve(__dirname, '..', 'openapi.json');
        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(JSON.stringify(doc)));
    });
});
