import rateLimit from 'express-rate-limit';
import {config} from '@config/index';

// Counts only failed requests per IP, so brute force on login/codes/reset is throttled.
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.authRateLimitMax,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});
