import {randomInt, randomUUID} from 'node:crypto';
import supertest from 'supertest';
import app from '../src/app';

export const api = supertest(app);

// Tests share one DB that is never wiped, so every username/email/phone must be unique.
export const uniqueName = (prefix = 'user') => `${prefix}_${randomUUID().slice(0, 8)}`;
export const uniqueEmail = () => `${uniqueName()}@example.com`;
export const uniquePhone = () => `9${String(randomInt(1e9)).padStart(9, '0')}`;
