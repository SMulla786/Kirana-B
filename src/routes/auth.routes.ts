import {Router} from 'express';
import rateLimit from 'express-rate-limit';
import {config} from '@config/index';
import {authController as c} from '@controllers/index';
import {authLimiter, verifyJWT} from '@middlewares/index';

// Requests that send email always succeed, so they are counted even on success.
const emailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.authRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});

const router = Router();

// Public
router.post('/register', emailLimiter, c.register);
router.post('/verify-code', authLimiter, c.verifyCode);
router.post('/resend-code', emailLimiter, c.resendCode);
router.post('/login', authLimiter, c.login);
router.post('/refresh', authLimiter, c.refresh);
router.post('/logout', c.logout);
router.post('/password/forgot', emailLimiter, c.forgotPassword);
router.post('/password/reset', authLimiter, c.resetPassword);

// Authenticated
router.use(verifyJWT);
router.get('/me', c.getMe);
router.patch('/me', c.updateMe);
router.post('/password/change', c.changePassword);
router.post('/logout-all', c.logoutAll);
router.get('/sessions', c.listSessions);
router.delete('/sessions/:id', c.revokeSession);

export default router;
