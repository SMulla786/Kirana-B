import {Router} from 'express';
import c from '@controllers/kirana/customer.controller';
import {verifyJWT, requirePermission} from '@middlewares/auth.middleware';

const router = Router();
router.use(verifyJWT, requirePermission('customers.manage'));

router.get('/', c.list);
router.post('/', c.create);

export default router;
