import {describe, expect, it} from 'vitest';
import {api} from './helpers';

describe('platform basics', () => {
    it('GET / answers with the API name', async () => {
        const res = await api.get('/');
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('KiranaOS API');
    });

    it('GET /health reports the database and returns a request id', async () => {
        const res = await api.get('/health');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({status: 'ok', db: 'up'});
        expect(res.headers['x-request-id']).toMatch(/^[\w-]+$/);
    });

    it('echoes a safe incoming request id and replaces an unsafe one', async () => {
        const good = await api.get('/health').set('X-Request-Id', 'abc-123');
        expect(good.headers['x-request-id']).toBe('abc-123');
        const bad = await api.get('/health').set('X-Request-Id', 'bad id;<script>');
        expect(bad.headers['x-request-id']).not.toBe('bad id;<script>');
    });

    it('unknown routes give a plain 404 without echoing the URL', async () => {
        const res = await api.get('/api/v1/nope?secret=1');
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({status: false, message: 'Not found'});
        expect(JSON.stringify(res.body)).not.toContain('secret');
    });

    it('malformed JSON is a 400 with a fixed message', async () => {
        const res = await api
            .post('/api/v1/auth/login')
            .set('Content-Type', 'application/json')
            .send('{"identifier": ');
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Invalid request body');
    });
});
