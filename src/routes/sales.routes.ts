import {Router} from 'express';
import c from '@controllers/kirana/sale.controller';
import {verifyJWT, requirePermission} from '@middlewares/auth.middleware';

const router = Router();
router.use(verifyJWT);

router.get('/', requirePermission('sales.view'), c.list);
router.get('/:id', requirePermission('sales.view'), c.get);
router.post('/:id/returns', requirePermission('sales.return'), c.createReturn);

export default router;
