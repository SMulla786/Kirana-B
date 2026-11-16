import {describe, expect, it} from 'vitest';
import {api} from './helpers';

describe('GET /', () => {
    it('returns the welcome message', async () => {
        const res = await api.get('/');

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Welcome to node api');
    });
});
