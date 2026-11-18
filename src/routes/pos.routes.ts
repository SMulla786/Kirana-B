import {Router} from 'express';
import c from '@controllers/kirana/pos.controller';
import {verifyJWT, requirePermission} from '@middlewares/auth.middleware';

const router = Router();
router.use(verifyJWT, requirePermission('pos.use'));

// Held bills are drafts: they never post stock or revenue.
router.get('/held', c.list);
router.post('/held', c.hold);
router.post('/held/:id/recall', c.recall);
router.delete('/held/:id', c.confirm);

export default router;
