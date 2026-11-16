import {Router} from 'express';
import c from '@controllers/kirana/stock.controller';
import {verifyJWT, requirePermission} from '@middlewares/auth.middleware';

const router = Router();
router.use(verifyJWT);

// Append-only: there is no update or delete route for movements.
router.get('/movements', requirePermission('catalog.read'), c.listMovements);
router.post('/movements', requirePermission('stock.manage'), c.recordMovement);

export default router;
