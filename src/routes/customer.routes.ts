import {Router} from 'express';
import c from '@controllers/kirana/customer.controller';
import l from '@controllers/kirana/customerLedger.controller';
import {verifyJWT, requirePermission} from '@middlewares/auth.middleware';

// Phase 5 (A-031). `c`: customers, adjustments and reversals; `l`: ledger, dues and collections.
const router = Router();
router.use(verifyJWT);

router.get('/', requirePermission('customers.view'), c.list);
router.post('/', requirePermission('customers.manage'), c.create);
router.get('/:id', requirePermission('customers.view'), c.get);
router.patch('/:id', requirePermission('customers.manage'), c.update);
router.post('/:id/adjustments', requirePermission('customers.credit'), c.adjust);
router.post('/:id/ledger/:entryId/reverse', requirePermission('customers.credit'), c.reverse);

router.get('/:id/ledger', requirePermission('customers.view'), l.ledger);
router.get('/:id/invoices', requirePermission('customers.view'), l.invoices);
router.post('/:id/payments', requirePermission('customers.collect'), l.collect);
router.get('/:id/payments/:paymentId', requirePermission('customers.view'), l.payment);

export default router;
