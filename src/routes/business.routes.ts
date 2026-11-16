import {Router} from 'express';
import {businessController as c} from '@controllers/index';
import {requirePermission, verifyJWT} from '@middlewares/index';

const router = Router();
router.use(verifyJWT);

router.get('/', requirePermission('business.read'), c.getBusiness);
router.patch('/', requirePermission('business.update'), c.updateBusiness);
router.get('/members', requirePermission('members.read'), c.listMembers);
router.post('/members', requirePermission('members.manage'), c.addMember);
router.patch('/members/:id', requirePermission('members.manage'), c.updateMember);

export default router;
